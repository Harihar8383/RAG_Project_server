// An in-memory replacement for the MongoDB collections. The real Mongoose models still validate every document,
// so required fields, enums and defaults behave as in production. Only the storage calls are replaced.
import User from "../../src/models/user.models.js";
import Project from "../../src/models/project.models.js";
import Document from "../../src/models/document.models.js";
import Chat from "../../src/models/chat.models.js";
import Message from "../../src/models/message.models.js";

const models = { User, Project, Document, Chat, Message };
const tables = {};
let seq = 0;
const objectId = () => (++seq).toString(16).padStart(24, "0");
const clock = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 1000).toISOString();

const same = (a, b) => String(a) === String(b);
function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) return cond.$in.some((v) => same(v, row[key]));
      if ("$eq" in cond) return same(cond.$eq, row[key]);
    }
    return same(cond, row[key]);
  });
}

const clone = (row) => JSON.parse(JSON.stringify(row));

function query(rows) {
  let list = rows;
  const q = {
    sort(spec) {
      const [[field, dir]] = Object.entries(spec);
      list = [...list].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir < 0 ? -1 : 1));
      return q;
    },
    then: (resolve, reject) => Promise.resolve(list.map(clone)).then(resolve, reject),
  };
  return q;
}

for (const [name, Model] of Object.entries(models)) {
  tables[name] = [];
  const rows = () => tables[name];

  Model.find = (filter) => query(rows().filter((r) => matches(r, filter)));
  Model.findOne = async (filter) => clone(rows().find((r) => matches(r, filter)) || null);
  Model.findById = async (id) => clone(rows().find((r) => same(r._id, id)) || null);
  Model.countDocuments = async (filter) => rows().filter((r) => matches(r, filter)).length;
  Model.create = async (data) => {
    const instance = new Model(data);
    const error = instance.validateSync();
    if (error) throw error;
    const row = JSON.parse(JSON.stringify(instance.toJSON()));
    row._id = objectId();
    if (name === "Document" && rows().some((r) => r.key === row.key)) {
      const dup = new Error("E11000 duplicate key error");
      dup.code = 11000;
      throw dup;
    }
    row.createdAt = clock();
    row.updatedAt = row.createdAt;
    rows().push(row);
    return clone(row);
  };
  Model.updateOne = async (filter, update) => {
    const row = rows().find((r) => matches(r, filter));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete row[key];
    row.updatedAt = clock();
    return { matchedCount: 1 };
  };
  Model.deleteOne = async (filter) => {
    const i = rows().findIndex((r) => matches(r, filter));
    if (i >= 0) rows().splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  };
  Model.deleteMany = async (filter) => {
    const keep = rows().filter((r) => !matches(r, filter));
    const deletedCount = rows().length - keep.length;
    tables[name] = keep;
    return { deletedCount };
  };
}

export const db = {
  rows: (name) => tables[name],
  reset() {
    for (const name of Object.keys(tables)) tables[name] = [];
  },
  /** Inserts a row without validation, for arranging test data. */
  insert(name, row) {
    const full = { _id: objectId(), createdAt: clock(), updatedAt: clock(), ...row };
    tables[name].push(full);
    return clone(full);
  },
};
