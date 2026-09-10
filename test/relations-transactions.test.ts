import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DataCatalog } from "../src/catalog/index.js";
import { DATA_PROTOCOL_LIMITS } from "../src/protocol/index.js";
import { DataRecordError, DataRecords } from "../src/records/index.js";
import { SqliteStorageDriver } from "../src/storage/index.js";
import {
  DataTransactionError,
  DataTransactions,
} from "../src/transactions/index.js";

const actor = { kind: "human", id: "operator" } as const;

let idempotencySequence = 0;
function nextIdempotencyKey(): string {
  idempotencySequence += 1;
  return `legacy-test:${idempotencySequence}`;
}


function withData(
  run: (
    catalog: DataCatalog,
    records: DataRecords,
    transactions: DataTransactions,
    database: ReturnType<SqliteStorageDriver["open"]>,
  ) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "ai-verse-data-relations-"));
  const database = new SqliteStorageDriver().open({
    location: join(directory, "data.sqlite"),
  });
  try {
    const catalog = new DataCatalog(database);
    const records = new DataRecords(database);
    const transactions = new DataTransactions(database);
    run(catalog, records, transactions, database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function bootstrap(catalog: DataCatalog): void {
  catalog.createSpace({
    spaceId: "crm",
    name: "CRM",
    authority: "local_canonical",
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "companies",
    name: "Companies",
    fields: {
      name: { type: "string", required: true },
    },
  });
  catalog.createSchema({
    spaceId: "crm",
    entity: "deals",
    name: "Deals",
    fields: {
      title: { type: "string", required: true },
      company: {
        type: "reference",
        entity: "companies",
        required: true,
      },
    },
  });
}

function assertRecordError(
  error: unknown,
  code: DataRecordError["code"],
): boolean {
  assert.ok(error instanceof DataRecordError);
  assert.equal(error.code, code);
  return true;
}

function assertTransactionError(
  error: unknown,
  code: DataTransactionError["code"],
): boolean {
  assert.ok(error instanceof DataTransactionError);
  assert.equal(error.code, code);
  return true;
}

test("direct create persists a normalized relation index for a valid reference", () => {
  withData((catalog, records, _transactions, database) => {
    bootstrap(catalog);
    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Acme" },
      actor,
    });
    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Launch", company: company.recordId },
      actor,
    });

    assert.deepEqual(
      database.relationStorage().listSourceRelations(
        "crm",
        "deals",
        deal.recordId,
      ),
      [
        {
          sourceSpaceId: "crm",
          sourceEntity: "deals",
          sourceRecordId: deal.recordId,
          field: "company",
          targetSpaceId: "crm",
          targetEntity: "companies",
          targetRecordId: company.recordId,
        },
      ],
    );
  });
});

test("direct create rejects missing references without leaving a record", () => {
  withData((catalog, records) => {
    bootstrap(catalog);

    assert.throws(
      () =>
        records.create({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          data: { title: "Broken", company: "rec_missing" },
          actor,
        }),
      (error) => assertRecordError(error, "REFERENCE_INVALID"),
    );

    assert.equal(
      records.list({ spaceId: "crm", entity: "deals" }).length,
      0,
    );
  });
});

test("updating a reference atomically replaces the relation index", () => {
  withData((catalog, records, _transactions, database) => {
    bootstrap(catalog);
    const first = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "First" },
      actor,
    });
    const second = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Second" },
      actor,
    });
    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Deal", company: first.recordId },
      actor,
    });

    const updated = records.update({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
      expectedVersion: 1,
      patch: { company: second.recordId },
      actor,
    });

    assert.equal(updated.data.company, second.recordId);
    const relations = database.relationStorage().listSourceRelations(
      "crm",
      "deals",
      deal.recordId,
    );
    assert.equal(relations.length, 1);
    assert.equal(relations[0]!.targetRecordId, second.recordId);
  });
});

test("invalid reference update rolls back both record and relation state", () => {
  withData((catalog, records, _transactions, database) => {
    bootstrap(catalog);
    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Acme" },
      actor,
    });
    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Deal", company: company.recordId },
      actor,
    });

    assert.throws(
      () =>
        records.update({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "deals",
          recordId: deal.recordId,
          expectedVersion: 1,
          patch: { company: "rec_missing" },
          actor,
        }),
      (error) => assertRecordError(error, "REFERENCE_INVALID"),
    );

    const after = records.get({
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
    });
    assert.equal(after.version, 1);
    assert.equal(after.data.company, company.recordId);
    assert.equal(
      database.relationStorage().listSourceRelations(
        "crm",
        "deals",
        deal.recordId,
      )[0]!.targetRecordId,
      company.recordId,
    );
  });
});

test("soft delete blocks referenced targets and deleting the source releases them", () => {
  withData((catalog, records) => {
    bootstrap(catalog);
    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Acme" },
      actor,
    });
    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Deal", company: company.recordId },
      actor,
    });

    assert.throws(
      () =>
        records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
          spaceId: "crm",
          entity: "companies",
          recordId: company.recordId,
          expectedVersion: 1,
          actor,
        }),
      (error) => assertRecordError(error, "REFERENCE_INVALID"),
    );

    records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      recordId: deal.recordId,
      expectedVersion: 1,
      actor,
    });

    const deletedCompany = records.softDelete({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      recordId: company.recordId,
      expectedVersion: 1,
      actor,
    });
    assert.ok(deletedCompany.deletedAt !== null);
  });
});

test("declared references may safely target another Data Space in the same workspace database", () => {
  withData((catalog, records) => {
    catalog.createSpace({
      spaceId: "crm",
      name: "CRM",
      authority: "local_canonical",
    });
    catalog.createSpace({
      spaceId: "production",
      name: "Production",
      authority: "local_canonical",
    });
    catalog.createSchema({
      spaceId: "crm",
      entity: "companies",
      name: "Companies",
      fields: { name: { type: "string", required: true } },
    });
    catalog.createSchema({
      spaceId: "production",
      entity: "jobs",
      name: "Jobs",
      fields: {
        name: { type: "string", required: true },
        client: {
          type: "reference",
          spaceId: "crm",
          entity: "companies",
          required: true,
        },
      },
    });

    const company = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Client" },
      actor,
    });
    const job = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "production",
      entity: "jobs",
      data: { name: "Shoot", client: company.recordId },
      actor,
    });

    assert.equal(job.data.client, company.recordId);
  });
});

test("transaction creates related records using an earlier clientRef atomically", () => {
  withData((catalog, records, transactions, database) => {
    bootstrap(catalog);

    const result = transactions.execute({
      actor,
      payload: {
        idempotencyKey: "txn-related-1",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "companies",
              idempotencyKey: "create-company-1",
              clientRef: "company",
              data: { name: "Acme" },
            },
          },
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "deals",
              idempotencyKey: "create-deal-1",
              data: {
                title: "Launch",
                company: { $ref: "company" },
              },
            },
          },
        ],
      },
    });

    assert.equal(result.operations.length, 2);
    assert.match(result.clientRefs.company!, /^rec_/);
    assert.equal(
      result.operations[1]!.record.data.company,
      result.clientRefs.company,
    );
    assert.equal(
      database.relationStorage().listSourceRelations(
        "crm",
        "deals",
        result.operations[1]!.record.recordId,
      )[0]!.targetRecordId,
      result.clientRefs.company,
    );
    assert.equal(records.list({ spaceId: "crm", entity: "companies" }).length, 1);
    assert.equal(records.list({ spaceId: "crm", entity: "deals" }).length, 1);
  });
});

test("transaction can update a reference to a record created earlier in the same transaction", () => {
  withData((catalog, records, transactions) => {
    bootstrap(catalog);
    const oldCompany = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "companies",
      data: { name: "Old" },
      actor,
    });
    const deal = records.create({
      idempotencyKey: nextIdempotencyKey(),
      spaceId: "crm",
      entity: "deals",
      data: { title: "Deal", company: oldCompany.recordId },
      actor,
    });

    const result = transactions.execute({
      actor,
      payload: {
        idempotencyKey: "txn-update-ref",
        operations: [
          {
            operation: "data.record.create",
            payload: {
              spaceId: "crm",
              entity: "companies",
              idempotencyKey: "create-new-company",
              clientRef: "new-company",
              data: { name: "New" },
            },
          },
          {
            operation: "data.record.update",
            payload: {
              spaceId: "crm",
              entity: "deals",
              recordId: deal.recordId,
              expectedVersion: 1,
              idempotencyKey: "update-deal",
              patch: { company: { $ref: "new-company" } },
            },
          },
        ],
      },
    });

    assert.equal(
      result.operations[1]!.record.data.company,
      result.clientRefs["new-company"],
    );
  });
});

test("a later invalid operation rolls back all earlier transaction mutations", () => {
  withData((catalog, records, transactions) => {
    bootstrap(catalog);

    assert.throws(
      () =>
        transactions.execute({
          actor,
          payload: {
            idempotencyKey: "txn-rollback",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "companies",
                  idempotencyKey: "create-company",
                  clientRef: "company",
                  data: { name: "Should Roll Back" },
                },
              },
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "deals",
                  idempotencyKey: "create-broken-deal",
                  data: {
                    title: "Broken",
                    company: "rec_missing",
                  },
                },
              },
            ],
          },
        }),
      (error) => assertRecordError(error, "REFERENCE_INVALID"),
    );

    assert.equal(records.list({ spaceId: "crm", entity: "companies" }).length, 0);
    assert.equal(records.list({ spaceId: "crm", entity: "deals" }).length, 0);
  });
});

test("forward transaction references fail and roll back", () => {
  withData((catalog, records, transactions) => {
    bootstrap(catalog);

    assert.throws(
      () =>
        transactions.execute({
          actor,
          payload: {
            idempotencyKey: "txn-forward",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "deals",
                  idempotencyKey: "create-deal",
                  data: {
                    title: "Forward",
                    company: { $ref: "company" },
                  },
                },
              },
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "companies",
                  idempotencyKey: "create-company",
                  clientRef: "company",
                  data: { name: "Later" },
                },
              },
            ],
          },
        }),
      (error) => assertTransactionError(error, "REFERENCE_INVALID"),
    );

    assert.equal(records.list({ spaceId: "crm", entity: "companies" }).length, 0);
    assert.equal(records.list({ spaceId: "crm", entity: "deals" }).length, 0);
  });
});

test("duplicate clientRef fails and rolls back the transaction", () => {
  withData((catalog, records, transactions) => {
    bootstrap(catalog);

    assert.throws(
      () =>
        transactions.execute({
          actor,
          payload: {
            idempotencyKey: "txn-duplicate-ref",
            operations: [
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "companies",
                  idempotencyKey: "create-one",
                  clientRef: "same",
                  data: { name: "One" },
                },
              },
              {
                operation: "data.record.create",
                payload: {
                  spaceId: "crm",
                  entity: "companies",
                  idempotencyKey: "create-two",
                  clientRef: "same",
                  data: { name: "Two" },
                },
              },
            ],
          },
        }),
      (error) => assertTransactionError(error, "TRANSACTION_INVALID"),
    );

    assert.equal(records.list({ spaceId: "crm", entity: "companies" }).length, 0);
  });
});

test("transaction operation count is hard bounded by the protocol ceiling", () => {
  withData((catalog, _records, transactions) => {
    bootstrap(catalog);
    const operations = Array.from(
      { length: DATA_PROTOCOL_LIMITS.maxTransactionOperations + 1 },
      (_, index) => ({
        operation: "data.record.create" as const,
        payload: {
          spaceId: "crm",
          entity: "companies",
          idempotencyKey: "create-" + index,
          data: { name: "Company " + index },
        },
      }),
    );

    assert.throws(
      () =>
        transactions.execute({
          actor,
          payload: {
            idempotencyKey: "txn-too-large",
            operations,
          },
        }),
      (error) => assertTransactionError(error, "TRANSACTION_INVALID"),
    );
  });
});
