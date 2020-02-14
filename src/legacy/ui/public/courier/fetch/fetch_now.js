/*
 * THIS FILE HAS BEEN MODIFIED FROM THE ORIGINAL SOURCE
 * This comment only applies to modifications applied after the f421eec40b5a9f31383591e30bef86724afcd2b3 commit
 *
 * Copyright 2020 LogRhythm, Inc
 * Licensed under the LogRhythm Global End User License Agreement,
 * which can be found through this page: https://logrhythm.com/about/logrhythm-terms-and-conditions/
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { fatalError } from '../../notify';
import { CallClientProvider } from './call_client';
import { CallResponseHandlersProvider } from './call_response_handlers';
import { ContinueIncompleteProvider } from './continue_incomplete';
import { RequestStatus } from './req_status';
import { i18n } from '@kbn/i18n';

import _ from 'lodash';
import moment from 'moment';
import { auditSearch } from '@logrhythm/nm-web-shared/services/audit';

const auditTimeFormat = 'YYYY/MM/DD HH:mm:ss';

/**
 * Fetch now provider should be used if you want the results searched and returned immediately.
 * This can be slightly inefficient if a large number of requests are queued up, we can batch these
 * by using fetchSoon. This introduces a slight delay which allows other requests to queue up before
 * sending out requests in a batch.
 *
 * @param Private
 * @param Promise
 * @return {fetchNow}
 * @constructor
 */
export function FetchNowProvider(Private, Promise) {
  // core tasks
  const callClient = Private(CallClientProvider);
  const callResponseHandlers = Private(CallResponseHandlersProvider);
  const continueIncomplete = Private(ContinueIncompleteProvider);

  const ABORTED = RequestStatus.ABORTED;
  const INCOMPLETE = RequestStatus.INCOMPLETE;

  function fetchNow(searchRequests) {
    return fetchSearchResults(
      searchRequests.map(function(searchRequest) {
        if (!searchRequest.started) {
          return searchRequest;
        }

        return searchRequest.retry();
      })
    ).catch(error => {
      // If any errors occur after the search requests have resolved, then we kill Kibana.
      fatalError(error, 'Courier fetch');
    });
  }

  function fetchSearchResults(searchRequests) {
    function replaceAbortedRequests() {
      searchRequests = searchRequests.map(searchRequest => {
        if (searchRequest.aborted) {
          return ABORTED;
        }

        return searchRequest;
      });
    }

    replaceAbortedRequests();
    return startRequests(searchRequests)
      .then(function() {
        replaceAbortedRequests();
        return callClient(searchRequests).catch(() => {
          // Silently swallow errors that result from search requests so the consumer can surface
          // them as notifications instead of courier forcing fatal errors.
        });
      })
      .then(function(responses) {
        replaceAbortedRequests();
        return callResponseHandlers(searchRequests, responses);
      })
      .then(function(responses) {
        replaceAbortedRequests();
        return continueIncomplete(searchRequests, responses, fetchSearchResults);
      })
      .then(function(responses) {
        replaceAbortedRequests();
        return responses.map(function(resp) {
          switch (resp) {
            case ABORTED:
              return null;
            case INCOMPLETE:
              throw new Error(
                i18n.translate('common.ui.courier.fetch.failedToClearRequestErrorMessage', {
                  defaultMessage: 'Failed to clear incomplete or duplicate request from responses.',
                })
              );
            default:
              return resp;
          }
        });
      });
  }

  async function auditFetch(searchSource) {
    const searchSourceFields = searchSource.getFields();

    let queryToAudit = '';
    let queryVal;
    if(Array.isArray(searchSourceFields.query)) {
      queryVal = searchSourceFields.query[searchSourceFields.query.length - 1].query || '';
    } else {
      queryVal = searchSourceFields.query.query || '';
    }

    if(queryVal) {
      queryToAudit = typeof queryVal === 'string' ? queryVal : _.get(queryVal, 'query_string.query', '');
    }

    const fields = searchSource.getParent().getFields();
    const filter = fields && typeof fields.filter === 'function' ? fields.filter() : null;
    const dateFilter = filter ? Object.values(searchSource.getParent().getFields().filter().range)[0] : null;

    if (
      !queryToAudit ||
      queryToAudit.trim() === '*' ||
      !dateFilter ||
      !dateFilter.gte ||
      !dateFilter.lte
    ) {
      return;
    }

    const formattedFrom = moment(dateFilter.gte).format(auditTimeFormat);
    const formattedTo = moment(dateFilter.lte).format(auditTimeFormat);

    await auditSearch({
      query: queryToAudit,
      from: formattedFrom,
      to: formattedTo
    });
  }

  function startRequests(searchRequests) {
    if(searchRequests.length > 0) {
      try {
        auditFetch(searchRequests[0].source)
          .catch(err => console.warn('An error occurred trying to audit the query.', err)); // eslint-disable-line
      } catch (err) {
        console.warn('An error occurred trying to audit the query.', err); // eslint-disable-line
      }
    }

    return Promise.map(searchRequests, function (searchRequest) {
      if (searchRequest === ABORTED) {
        return searchRequest;
      }

      return new Promise(function(resolve) {
        const action = searchRequest.started ? searchRequest.continue : searchRequest.start;
        resolve(action.call(searchRequest));
      }).catch(err => searchRequest.handleFailure(err));
    });
  }

  return fetchNow;
}
