// An in-memory replacement for the MongoDB collections. The real Mongoose models still validate every document,
// so required fields, enums and defaults behave as in production. Only the storage calls are replaced.
import User from "../../src/models/user.models.js";
import Project from "../../src/models/project.models.js";
import Document from "../../src/models/document.models.js";
import Chat from "../../src/models/chat.models.js";
import Message from "../../src/models/message.models.js";
import Usage from "../../src/models/usage.models.js";

const models = { User, Project, Document, Chat, Message, Usage };
const tables = {};
let seq = 0;
const objectId = () => (++seq).toString(16).padStart(24, "0");
const clock = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 1000).toISOString();

const same = (a, b) => String(a) === String(b);
function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key.includes(".")) {
      const [list, field] = key.split(".");
      return (row[list] || []).some((item) => matches(item, { [field]: cond }));
    }
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
    limit(n) {
      list = list.slice(0, n);
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
    const unique = name === "Document" ? "key" : name === "User" ? "clerkId" : null;
    if (unique && rows().some((r) => r[unique] === row[unique])) {
      const dup = new Error("E11000 duplicate key error");
      dup.code = 11000;
      throw dup;
    }
    row.createdAt = clock();
    row.updatedAt = row.createdAt;
    rows().push(row);
    return clone(row);
  };
  // Supports plain fields, the positional "list.$.field" and the filtered "list.$[name].field".
  const targets = (row, path, filter, arrayFilters) => {
    const [list, marker, field] = path.split(".");
    if (!marker) return [[row, path]];
    const wanted = (source, prefix) =>
      Object.fromEntries(Object.entries(source).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
    const cond = marker === "$" ? wanted(filter, `${list}.`) : wanted(arrayFilters[0], `${marker.slice(2, -1)}.`);
    return (row[list] || []).filter((item) => matches(item, cond)).map((item) => [item, field]);
  };
  const apply = (row, update, filter = {}, arrayFilters = []) => {
    for (const [path, value] of Object.entries(update.$set || {})) {
      for (const [target, key] of targets(row, path, filter, arrayFilters)) target[key] = value;
    }
    for (const path of Object.keys(update.$unset || {})) {
      for (const [target, key] of targets(row, path, filter, arrayFilters)) delete target[key];
    }
    for (const [key, by] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + by;
    row.updatedAt = clock();
  };
  Model.updateOne = async (filter, update) => {
    const row = rows().find((r) => matches(r, filter));
    if (!row) return { matchedCount: 0 };
    apply(row, update, filter);
    return { matchedCount: 1 };
  };
  Model.updateMany = async (filter, update, options = {}) => {
    const hit = rows().filter((r) => matches(r, filter));
    hit.forEach((row) => apply(row, update, filter, options.arrayFilters));
    return { matchedCount: hit.length, modifiedCount: hit.length };
  };
  Model.findOneAndUpdate = async (filter, update, options = {}) => {
    let row = rows().find((r) => matches(r, filter));
    if (!row && !options.upsert) return null;
    const before = row ? clone(row) : null;
    if (!row) {
      const plain = Object.fromEntries(Object.entries(filter).filter(([, v]) => v === null || typeof v !== "object" || v.constructor?.name === "ObjectId"));
      row = { _id: objectId(), createdAt: clock(), ...JSON.parse(JSON.stringify(plain)) };
      rows().push(row);
    }
    apply(row, update);
    return options.new ? clone(row) : before;
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
