'use strict';

function wrap(db, dir) {
  // TODO if I put a failure right here,
  // why doesn't the unhandled promise rejection fire?
  var PromiseA = require('bluebird');
  var promises = [];
  var dbsMap = {};
  var arr = true;

  function lowerFirst(str) {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  function snakeCase(str) {
    return lowerFirst(str).replace(
      /([A-Z])/g
    , function ($1) {
        return "_" + $1.toLowerCase();
      }
    );
  }

  function camelCase(str) {
    return str.replace(
      /_([a-z])/g
    , function (g) {
      return g[1].toUpperCase();
    });
  }

  function upperCamelCase(str) {
    // TODO handle UTF-8 properly (use codePointAt, don't use slice)
    return camelCase(str).charAt(0).toUpperCase() + str.slice(1);
  }

  function createTable(opts) {
    var DB = {};
    var tablename = db.escape(snakeCase(opts.tablename) || 'data');
    var idname = db.escape(snakeCase(opts.idname) || 'id');
    var idnameCased = (camelCase(opts.idname) || 'id');

    db = PromiseA.promisifyAll(db);

    if (opts && opts.verbose || db.verbose) {
      console.log('Getting Verbose up in here');
      db.on('trace', function (str) {
        console.log('SQL:', str);
      });

      db.on('profile', function (sql, ms) {
        console.log('Profile:', ms);
      });
    }

    function simpleParse(row) {
      var obj;

      if (!row) {
        return null;
      }

      if (row.json) {
        obj = JSON.parse(row.json);
      } else {
        obj = {};
      }

      obj[idnameCased] = row[idname];

      return obj;
    }

    function simpleMap(rows) {
      if (!rows) {
        return [];
      }

      var results = rows.map(function (row, i) {
        // set up for garbage collection
        rows[i] = null;

        var obj;

        if (row.json) {
          obj = JSON.parse(row.json);
        } else {
          obj = {};
        }

        obj[idnameCased] = row[idname];
      });
      // set up for garbage collection
      rows.length = 0;
      rows = null;

      return results;
    }

    DB.find = function (opts, params) {
      var sql = 'SELECT * FROM ' + tablename + ' WHERE ';

      Object.keys(opts).forEach(function (key, i) {
        if (i !== 0) {
          sql += 'AND ';
        }
        sql += db.escape(snakeCase(key)) + " = '" + db.escape(opts[key]) + "'";
      });

      if (params) {
        if (params.orderBy) {
          sql += ' ORDER BY ' + db.escape(snakeCase(params.orderBy));
          if (params.orderByDesc) {
            sql += ' DESC';
          }
        }
      }

      return db.allAsync(sql, []).then(simpleMap);
    };

    DB.get = function (id) {
      var sql = "SELECT * FROM " + tablename + " WHERE " + idname + " = ?";
      var values = [id];

      return db.getAsync(sql, values).then(function (rows) {
        if (Array.isArray(rows)) {
          if (!rows.length) {
            return null;
          }

          return rows[0] || null;
        }

        return rows;
      }).then(simpleParse);
    };

    DB.upsert = function (id, data) {
      return DB.set(id, data).then(function (result) {
        var success = result.changes >= 1;

        if (success) {
          return result;
        }

        return DB.create(id, data);
      });
    };

    DB.save = function (data) {
      if (!data[idnameCased]) {
        // NOTE saving the id both in the object and the id for now
        var UUID = require('node-uuid');
        data[idnameCased] = UUID.v4();
        return DB.create(data[idnameCased], data).then(function (/*stats*/) {
          //data._rowid = stats.id;
          return data;
        });
      }

      return DB.set(data[idnameCased], data).then(function (result) {
        var success = result.changes >= 1;

        if (success) {
          return result;
        } else {
          console.log('[debug result of set]', result.sql);
          delete result.sql;
          console.log(result);
        }

        return null;
      });
    };

    DB.create = function (id, obj) {
      if (!obj) {
        obj = id;
        id = obj[idnameCased];
      }
      if (!id) {
        return PromiseA.reject(new Error("no id supplied"));
      }

      return new PromiseA(function (resolve, reject) {
        var json = JSON.stringify(obj);
        var data = JSON.parse(json);

        var sql;

        // removes known fields from data
        sql = strainUpdate(id, data, function sqlTpl(fieldable) {
          return "INSERT INTO " + tablename + " (" + fieldable.join(', ') + ", " + idname + ")"
            //+ " VALUES ('" + vals.join("', '") + "')"
            + " VALUES (" + fieldable.map(function () { return '?'; }).join(", ") + ", ?)"
            ;
        });

        console.log('[debug] DB.create() sql:', sql);
        db.run(sql, [], function (err) {
          if (err) {
            reject(err);
            return;
          }

          // NOTE changes is 1 even if the value of the updated record stays the same
          // (PostgreSQL would return 0 in that case)
          // thus if changes is 0 then it failed, otherwise it succeeded
          /*
          console.log('[log db wrapper insert]');
          console.log(this); // sql, lastID, changes
          console.log(this.sql);
          console.log('insert lastID', this.lastID); // sqlite's internal rowId
          console.log('insert changes', this.changes);
          */

          //this.id = id;
          resolve(this);
        });
      });
    };

    // pull indices from object
    function strainUpdate(id, data/*, vals*/, cb) {
      var fieldable = [];
      var json;
      var sql;
      var vals = [];

      (opts.indices || []).forEach(function (col) {
        if ('string' === typeof col) {
          col = { name: col, type: 'TEXT' };
        }
        if (!col.type) {
          col.type = 'TEXT';
        }

        var val = data[camelCase(col.name)];

        //if (col.name in data)
        if ('undefined' !== typeof val) {
          /*
          fieldable.push(
            db.escape(snakeCase(col.name))
          + " = '" + db.escape(val) + "'"
          );
          */
          fieldable.push(db.escape(snakeCase(col.name)));
          vals.push(val);
        }

        delete data[col.name];
        delete data[camelCase(col.name)];
      });

      delete data[idnameCased];

      if (!fieldable.length || Object.keys(data).length) {
        json = JSON.stringify(data);
        fieldable.push("json");
        //fieldable.push("json = '" + db.escape(json) + "'");
        vals.push(json);
      }

      vals.push(id);

      sql = cb(fieldable);

      while (vals.length) {
        sql = sql.replace(/\?/, "'" + db.escape(vals.shift()) + "'");
      }

      return sql;
    }

    DB.set = function (id, obj) {
      var json = JSON.stringify(obj);
      var data = JSON.parse(json);

      return new PromiseA(function (resolve, reject) {
        function sqlTpl(fieldable) {
          // this will always at least have one fieldable value: json
          return "UPDATE " + tablename + " SET "
            + (fieldable.join(' = ?, ') + " = ?")
            + " WHERE " + idname + " = ?"
            ;
        }

        //var vals = [];
        // removes known fields from data
        var sql = strainUpdate(id, data/*, vals*/, sqlTpl);

        console.log('[debug] DB.set() sql:', sql);
        db.run(sql, /*vals*/[], function (err) {
          if (err) {
            reject(err);
            return;
          }

          // it isn't possible to tell if the update succeeded or failed
          // only if the update resulted in a change or not
          /*
          console.log('[log db wrapper set]');
          console.log(this); // sql, lastID, changes
          console.log(this.sql);
          console.log('update lastID', this.lastID); // always 0 (except on INSERT)
          console.log('update changes', this.changes);
          */

          resolve(this);
        });
      });
    };

    DB.destroy = function (id) {
      if ('object' === typeof id) {
        id = id[idnameCased];
      }

      return new PromiseA(function (resolve, reject) {
        var sql = "DELETE FROM " + tablename + " WHERE " + idname + " = ?";
        var values = [id];

        db.run(sql, values, function (err) {
          if (err) {
            reject(err);
            return;
          }

          // it isn't possible to tell if the update succeeded or failed
          // only if the update resulted in a change or not
          /*
          console.log('[log db wrapper delete]');
          console.log(this); // sql, lastID, changes
          console.log(this.sql);
          console.log('delete lastID', this.lastID); // always 0 (except on INSERT)
          console.log('delete changes', this.changes);
          */

          resolve(this);
        });
      });
    };

    DB._db = db;

    return new PromiseA(function (resolve, reject) {
      var indexable = [idname + ' TEXT'];
      var sql;

      (opts.indices || []).forEach(function (col) {
        if ('string' === typeof col) {
          col = { name: col, type: 'TEXT' };
        }
        if (!col.type) {
          col.type = 'TEXT';
        }
        indexable.push(
          db.escape(snakeCase(col.name))
        + ' ' + db.escape(col.type)
        );
      });
      indexable.push('json TEXT');

      sql = "CREATE TABLE IF NOT EXISTS '" + tablename + "' "
        + "(" + indexable.join(', ') + ", PRIMARY KEY(" + idname + "))"
        ;

      db.runAsync(sql).then(function () { resolve(DB); }, reject);
    });
  }

  if (!Array.isArray(dir)) {
    arr = false;
    dir = [dir];
  }

  dir.forEach(function (opts) {
    promises.push(createTable(opts).then(function (dbw) {
      var tablename = (opts.tablename || 'data');

      tablename = upperCamelCase(tablename);

      dbsMap[tablename] = dbw;

      return dbw;
    }));
  });

  dbsMap.sql = db;

  return PromiseA.all(promises).then(function (dbs) {
    if (!arr) {
      return dbs[0];
    }

    return dbsMap;
  });
}

module.exports.wrap = wrap;
