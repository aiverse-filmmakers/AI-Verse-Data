# AI-Verse Data Query and Aggregates v0.1

**Status:** Implemented in Phase 1.7  
**Date:** 2026-09-10

This document defines the first safe general query and aggregate engine for AI-Verse Data.

## 1. Purpose

Phase 1.7 makes canonical records selectively searchable without exposing SQL.

The path is:

```text
validated Query/Aggregate payload
  -> current entity schema
  -> semantic field/operator validation
  -> storage-neutral query plan
  -> parameterized SQLite compiler
  -> canonical stored records
  -> historical-schema hydration
  -> projection/result
```

Raw SQL is never part of the normal query API.

## 2. Public surface

Package subpath:

```text
@ai-verse/data/query
```

Primary API:

```ts
const dataQuery = new DataQuery(database)

dataQuery.query(...)
dataQuery.aggregate(...)
```

Query and aggregate payloads use the protocol types already defined in `@ai-verse/data/protocol`.

## 3. Query operations

A query may specify:

```text
spaceId
entity
select?
where?
orderBy?
limit?
cursor?
includeDeleted?
```

Example:

```json
{
  "spaceId": "crm",
  "entity": "deals",
  "select": ["title", "value", "stage"],
  "where": {
    "and": [
      { "field": "stage", "op": "eq", "value": "proposal" },
      { "field": "value", "op": "gte", "value": 10000 }
    ]
  },
  "orderBy": [
    { "field": "value", "direction": "desc" }
  ],
  "limit": 50
}
```

## 4. Supported filters

The implemented operators are:

```text
eq
neq
lt
lte
gt
gte
in
not_in
contains
starts_with
is_null
is_not_null
```

Boolean composition supports:

```text
and
or
not
```

The protocol already enforces maximum depth, node count, `in` list size, sort keys, selected fields, and page size.

## 5. Field/operator compatibility

Query shape is not enough. Phase 1.7 validates operator meaning against the current entity schema.

Conservative v0.1 rules:

```text
string:
  eq neq lt lte gt gte in not_in contains starts_with is_null is_not_null

number/integer:
  eq neq lt lte gt gte in not_in is_null is_not_null

date/datetime:
  eq neq lt lte gt gte in not_in is_null is_not_null

boolean:
  eq neq in not_in is_null is_not_null

enum:
  eq neq in not_in is_null is_not_null

reference/attachment_ref:
  eq neq in not_in is_null is_not_null

json:
  is_null is_not_null
```

Query values must match the declared field type. Enum values must be declared enum members. Date and datetime values receive the same strict date/time validation used elsewhere in Data.

Flexible undeclared fields are not filter/sort/aggregate targets even when `allowUnknownFields: true`. They can still be returned with the record. This avoids inventing type semantics for unknown data.

## 6. Selection

`select` projects only record `data` fields.

Canonical record metadata remains present:

```text
recordId
schemaVersion
version
createdAt
updatedAt
createdBy
updatedBy
deletedAt
deletedReason
deletedBy
```

Selected fields must:

- exist in the declared current schema;
- be unique;
- stay under the protocol selection ceiling.

If a historical record predates a safely added field, that selected field may simply be absent from that record's projected `data`.

## 7. Sorting

Sorts are schema-validated and bounded by `maxSortKeys`.

SQLite receives only:

- validated field JSON paths as bound parameters;
- direction from the fixed `asc | desc` enum.

A stable `record_id ASC` tie-breaker is appended internally.

JSON fields are not sortable in v0.1.

## 8. Pagination and cursors

The public API uses opaque cursors.

Phase 1.7 cursor payloads contain only:

```text
version
offset
query fingerprint
```

They are base64url encoded and are not SQL fragments.

The fingerprint is SHA-256 over a deterministic representation of:

- Data Space;
- entity;
- selection;
- filter;
- sort;
- page size;
- deleted-row visibility.

A cursor from one query shape cannot be reused with another query shape.

The first implementation uses bounded offset pagination internally, with:

```text
MAX_QUERY_OFFSET = 100000
```

That is an implementation ceiling, not caller-controlled authority.

A later release may replace the internal cursor strategy with keyset pagination while keeping the public cursor shape opaque.

## 9. Server ceilings

The engine uses the protocol hard limits regardless of caller intent.

Current page limits:

```text
default query page size = 50
maximum query page size = 200
maximum cursor offset   = 100000
```

Malformed or over-ceiling cursors fail visibly.

## 10. Deleted rows

Normal queries exclude soft-deleted records.

```text
includeDeleted absent/false
  -> deleted rows hidden

includeDeleted true
  -> deleted rows may be returned
```

Aggregates always exclude soft-deleted rows in v0.1 because the current aggregate protocol has no `includeDeleted` option.

## 11. Canonical hydration

SQLite query results are not returned directly.

Every stored row passes through the same internal `hydrateStoredRecord` path used by normal CRUD reads.

That means query results receive:

- stored JSON parsing;
- historical schema lookup;
- historical-schema validation;
- timestamp validation;
- actor attribution validation;
- corruption fail-closed behavior.

This prevents query execution from becoming a weaker read path than `DataRecords.get`.

## 12. Storage-neutral query plan

The Data engine depends on:

```text
DataQueryStorage
```

SQLite provides:

```text
SqliteQueryStorage
```

The semantic layer sends validated structured query plans to storage. The public Data query API does not depend on `better-sqlite3` or SQL strings.

## 13. Parameterized SQLite compilation

Dynamic query values are always bound parameters.

Field JSON paths are also bound parameters.

The only SQL fragments selected dynamically are fixed engine-controlled tokens such as:

- known comparison operators;
- `ASC` / `DESC`;
- aggregate function names from the fixed operator enum.

Aggregate aliases are protocol-validated field-name identifiers and are additionally quoted by the SQLite driver.

SQL-looking user values remain inert values.

Example:

```text
' OR 1=1 --
```

is bound as a string value. It is never concatenated into executable SQL.

## 14. LIKE safety

`contains` and `starts_with` use SQL `LIKE` internally.

User wildcard characters are escaped:

```text
%
_
\
```

so a literal value such as `100%` searches for the percent character rather than broadening the predicate.

## 15. Aggregates

Supported aggregate functions:

```text
count
sum
min
max
avg
```

Rules:

```text
count:
  counts matching records
  field must be omitted

sum/avg:
  number or integer fields only

min/max:
  string, number, integer, date, or datetime fields
```

Aliases must be unique.

Aggregate filters use the same field/operator semantic validation as normal queries.

## 16. Empty aggregate behavior

SQLite-compatible v0.1 results for an empty matching set are:

```text
count -> 0
sum   -> null
min   -> null
max   -> null
avg   -> null
```

These values are returned explicitly rather than fabricated as zero for non-count metrics.

## 17. Errors

The query layer uses:

```text
QUERY_INVALID
QUERY_LIMIT_EXCEEDED
DATABASE_CORRUPT
```

Examples of `QUERY_INVALID`:

- undeclared field;
- wrong value type;
- unsupported operator for field type;
- duplicate selected field;
- duplicate sort field;
- duplicate aggregate alias;
- malformed cursor;
- cursor/query fingerprint mismatch;
- aggregate function used on an incompatible type.

## 18. Deliberately not implemented

Phase 1.7 does not implement:

- cross-entity joins;
- declared relation traversal;
- relation existence checks;
- multi-record transactions;
- intra-transaction references;
- full-text search;
- formulas/computed expressions;
- arbitrary SQL;
- user-defined aggregate expressions;
- row-level permission filtering;
- keyset cursor optimization;
- query indexes derived from arbitrary entity fields.

Relations and bounded transactions are Task 8 / 41.

Performance/index tuning is handled later after measured workloads rather than guessing now.

## 19. Non-negotiable invariants

1. No normal query accepts SQL text.
2. Query values remain bound parameters.
3. Filter/sort/aggregate fields must be declared schema fields.
4. Field/operator combinations are validated before storage execution.
5. Query limits are engine-enforced.
6. Cursors are opaque, bounded, and tied to one query shape.
7. Query results use canonical record hydration.
8. Soft-deleted rows are hidden unless explicitly allowed by the operation.
9. Aggregates cannot silently coerce incompatible field types.
10. Task 1.8 relations/transactions remain absent until their own gate.
