import { isString } from "lodash";
import {
  RECURRENCE_FIELD_NAMES,
  recurrenceOccursInScope,
} from "core/utils/contexts/recurrenceOccurrence";
import { dateAfter, dateBefore, empty, FilterFunctionType, greaterThan, isSameDay, isSameDayAsToday, lessThan, listEquals, listIncludes, olderThan, stringCompare, stringEqual, withinLast } from "../filter";


export const filterFnTypes: FilterFunctionType = {
  occursToday: {
    type: ["option"],
    scopedFields: [...RECURRENCE_FIELD_NAMES],
    // The selected column may be named either `cadence` or `recurrence`.
    // filterReturnForCol already resolved its live cell as `value`, so project
    // that value onto the evaluator's canonical cadence key instead of
    // guessing which supported column name was selected.
    fn: (value, _filterValue, row) =>
      !!row && recurrenceOccursInScope({ ...row, cadence: value }, "today"),
    valueType: "none",
  },
  occursThisWeek: {
    type: ["option"],
    scopedFields: [...RECURRENCE_FIELD_NAMES],
    fn: (value, _filterValue, row) =>
      !!row && recurrenceOccursInScope({ ...row, cadence: value }, "iso-week"),
    valueType: "none",
  },
  isNotEmpty: {
    type: ["text", "file", "number", "option", "option-multi", "link", "link-multi", 'image'],
    fn: (v, f) => !empty(v, ''),
    valueType: "none",
  },
  isEmpty: {
    type: ["text", "file", "number", "option", "option-multi", "link", "link-multi", 'image'],
    fn: (v, f) => empty(v, ''),
    valueType: "none",
  },
  include: {
    fn: (v, f) => stringCompare(v, f),
    type: ["text", "file", "link", 'image'],
    valueType: "text",
  },
  notInclude: {
    type: ["text", "file", "link", 'image'],
    fn: (v, f) => !stringCompare(v, f),
    valueType: "text",
  },
  is: {
    type: ["text"],
    fn: (v, f) => stringEqual(v, f),
    valueType: "text",
  },
  isNot: {
    type: ["text"],
    fn: (v, f) => !stringEqual(v, f),
    valueType: "text",
  },
  equal: {
    type: ["number"],
    fn: (v, f) => stringEqual(v, f),
    valueType: "number",
  },
  isLink: {
    type: ["link", "context"],
    fn: (v, f) => stringEqual(v, f),
    valueType: "link",
  },
  isNotLink: {
    type: ["link", "context"],
    fn: (v, f) => !stringEqual(v, f),
    valueType: "link",
  },
  isGreatThan: {
    type: ["number"],
    fn: (v, f) => greaterThan(v, f),
    valueType: "number",
  },
  isLessThan: {
    type: ["number"],
    fn: (v, f) => lessThan(v, f),
    valueType: "number",
  },
  isLessThanOrEqual: {
    type: ["number"],
    fn: (v, f) => !greaterThan(v, f),
    valueType: "number",
  },
  isGreatThanOrEqual: {
    type: ["number"],
    fn: (v, f) => !lessThan(v, f),
    valueType: "number",
  },
  dateBefore: {
    type: ["date"],
    fn: (v, f) =>  dateBefore(v, f),
    valueType: "date",
  },
  dateAfter: {
    type: ["date"],
    fn: (v, f) =>  dateAfter(v, f),
    valueType: "date",
  },
  isSameDate: {
    type: ["date"],
    fn: (v, f) => isSameDay(v, f),
    valueType: "date",
  },
  isSameDateAsToday: {
    type: ["date"],
    fn: (v, f) => isSameDayAsToday(v, f),
    valueType: "none",
  },
  // ADR 0066 / Notidian-l12a: now-relative date operators for the Topic Hub
  // Recently-Closed/Stalled overlays. valueType 'date' mirrors
  // dateBefore/dateAfter above -- at eval time filterReturnForCol only reads
  // fType when it equals 'property' (a dynamic value looked up from another
  // property), so a literal overlay-constructed token (e.g. '7d') still flows
  // straight through as filter.value regardless of valueType. The manual
  // FilterBar value-editor dispatches on this SAME valueType and falls back
  // to the plain date-picker dateBefore/dateAfter use, which cannot express a
  // relative token by hand -- a known, separately-filed gap (Notidian-2l1y),
  // not fixed here.
  withinLast: {
    type: ["date"],
    fn: (v, f) => withinLast(v, f),
    valueType: "date",
  },
  olderThan: {
    type: ["date"],
    fn: (v, f) => olderThan(v, f),
    valueType: "date",
  },
  isExactList: {
    type: ["option", "option-multi","link-multi", "context-multi", 'tags-multi'],
    fn: (v, f) => listEquals(v, f),
    valueType: "list",
  },
  isAnyInList: {
    type: ["option", "context", 'link', "option-multi", 'link-multi', "context-multi", 'tags-multi'],
    fn: (v, f) => listIncludes(v, f),
    valueType: "list",
  },
  isNoneInList: {
    type: ["option", "context", 'link', "option-multi", 'link-multi', "context-multi", 'tags-multi'],
    fn: (v, f) => !listIncludes(v, f),
    valueType: "list",
  },
  isTrue: {
    type: ["boolean"],
    fn: (v, f) => isString(v) ? v == "true" : v,
    valueType: "none",
  },
  isFalse: {
    type: ["boolean"],
    fn: (v, f) => isString(v) ? v != "true" : !v,
    valueType: "none",
  },
};
