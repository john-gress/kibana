/*
 * THIS FILE HAS BEEN MODIFIED FROM THE ORIGINAL SOURCE
 * This comment only applies to modifications applied after the e633644c43a0a0271e0b6c32c382ce1db6b413c3 commit
 *
 * Copyright 2019 LogRhythm, Inc
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

import { stringify as formatQueryString } from 'querystring';

import $ from 'jquery';

const esVersion = [];

export function getVersion() {
  return esVersion;
}

export function getContentType(body) {
  if (!body) return;
  return 'application/json';
}

export function send(method, path, data) {
  const wrappedDfd = $.Deferred();  // eslint-disable-line new-cap

  const isGetRequest = /^get$/i.test(method);
  if (data && isGetRequest) {
    method = 'POST';
  }

  const options = {
    url: '../api/console/proxy?' + formatQueryString({ path, method }),
    data,
    contentType: getContentType(data),
    cache: false,
    crossDomain: true,
    type: 'POST',
    dataType: 'text', // disable automatic guessing
  };


  $.ajax(options).then(
    function (data, textStatus, jqXHR) {
      wrappedDfd.resolveWith(this, [data, textStatus, jqXHR]);
    },
    function (jqXHR, textStatus, errorThrown) {
      if (jqXHR.status === 0) {
        jqXHR.responseText = '\n\nFailed to connect to Console\'s backend.\nPlease check the NetMon server is up and running';
      }
      wrappedDfd.rejectWith(this, [jqXHR, textStatus, errorThrown]);
    });
  return wrappedDfd;
}

export function constructESUrl(baseUri, path) {
  baseUri = baseUri.replace(/\/+$/, '');
  path = path.replace(/^\/+/, '');
  return baseUri + '/' + path;
}
