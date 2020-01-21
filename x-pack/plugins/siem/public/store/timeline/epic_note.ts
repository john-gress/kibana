/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { ApolloClient } from 'apollo-client';
import { NormalizedCacheObject } from 'apollo-cache-inmemory';
import { get } from 'lodash/fp';
import { Action } from 'redux';
import { Epic } from 'redux-observable';
import { from, empty, Observable } from 'rxjs';
import { filter, mergeMap, switchMap, withLatestFrom, startWith, takeUntil } from 'rxjs/operators';

import { persistTimelineNoteMutation } from '../../containers/timeline/notes/persist.gql_query';
import { PersistTimelineNoteMutation, ResponseNote } from '../../graphql/types';
import { updateNote } from '../app/actions';
import { NotesById } from '../app/model';

import {
  addNote,
  addNoteToEvent,
  endTimelineSaving,
  updateTimeline,
  startTimelineSaving,
} from './actions';
import { TimelineById } from './reducer';
import { myEpicTimelineId } from './my_epic_timeline_id';
import { refetchQueries } from './refetch_queries';
import { dispatcherTimelinePersistQueue } from './epic_dispatcher_timeline_persistence_queue';
export const timelineNoteActionsType = [addNote.type, addNoteToEvent.type];

export const epicPersistNote = (
  apolloClient: ApolloClient<NormalizedCacheObject>,
  action: Action,
  timeline: TimelineById,
  notes: NotesById,
  action$: Observable<Action>,
  timeline$: Observable<TimelineById>,
  notes$: Observable<NotesById>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Observable<any> =>
  from(
    apolloClient.mutate<
      PersistTimelineNoteMutation.Mutation,
      PersistTimelineNoteMutation.Variables
    >({
      mutation: persistTimelineNoteMutation,
      fetchPolicy: 'no-cache',
      variables: {
        noteId: null,
        version: null,
        note: {
          eventId: get('payload.eventId', action),
          note: getNote(get('payload.noteId', action), notes),
          timelineId: myEpicTimelineId.getTimelineId(),
        },
      },
      refetchQueries,
    })
  ).pipe(
    withLatestFrom(timeline$, notes$),
    mergeMap(([result, recentTimeline, recentNotes]) => {
      const noteIdRedux = get('payload.noteId', action);
      const response: ResponseNote = get('data.persistNote', result);

      return [
        recentTimeline[get('payload.id', action)].savedObjectId == null
          ? updateTimeline({
              id: get('payload.id', action),
              timeline: {
                ...recentTimeline[get('payload.id', action)],
                savedObjectId: response.note.timelineId || null,
                version: response.note.timelineVersion || null,
              },
            })
          : null,
        updateNote({
          note: {
            ...recentNotes[noteIdRedux],
            created:
              response.note.updated != null
                ? new Date(response.note.updated)
                : recentNotes[noteIdRedux].created,
            user:
              response.note.updatedBy != null
                ? response.note.updatedBy
                : recentNotes[noteIdRedux].user,
            saveObjectId: response.note.noteId,
            version: response.note.version,
          },
        }),
        endTimelineSaving({
          id: get('payload.id', action),
        }),
      ].filter(item => item != null);
    }),
    startWith(startTimelineSaving({ id: get('payload.id', action) })),
    takeUntil(
      action$.pipe(
        withLatestFrom(timeline$),
        filter(([checkAction, updatedTimeline]) => {
          if (
            checkAction.type === endTimelineSaving.type &&
            updatedTimeline[get('payload.id', checkAction)].savedObjectId != null
          ) {
            myEpicTimelineId.setTimelineId(
              updatedTimeline[get('payload.id', checkAction)].savedObjectId
            );
            myEpicTimelineId.setTimelineVersion(
              updatedTimeline[get('payload.id', checkAction)].version
            );
            return true;
          }
          return false;
        })
      )
    )
  );

export const createTimelineNoteEpic = <State>(): Epic<Action, Action, State> => action$ =>
  action$.pipe(
    withLatestFrom(),
    filter(([action]) => timelineNoteActionsType.includes(action.type)),
    switchMap(([action]) => {
      dispatcherTimelinePersistQueue.next({ action });
      return empty();
    })
  );

const getNote = (noteId: string | undefined | null, notes: NotesById): string => {
  if (noteId != null) {
    return notes[noteId].note;
  }
  return '';
};
