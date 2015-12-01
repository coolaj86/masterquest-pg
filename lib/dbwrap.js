'use strict';

function wrap(db, dir) {
  // TODO if I put a failure right here,
  // why doesn't the unhandled promise rejection fire?
  var PromiseA = require('bluebird');
  var promises = [];
  var dbsMap = {};
  var earr = [];
  var format = require('pg-format');
  //var debug = true;
  var debug = false;
  //var dollarTag = '$' + require('crypto').randomBytes(8).toString('base64').replace(/=/g, '') + '$';
  /*
  function pgEscape(val) {
    return dollarTag + val + dollarTag;
  }
  db.escape = pgEscape;
  */

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
    str = str.replace(
      /_([a-z])/g
    , function (g) {
        return g[1].toUpperCase();
      }
    );
    return str;
  }

  function upperCamelCase(str) {
    // TODO handle UTF-8 properly (use codePointAt, don't use slice)
    return str.charAt(0).toUpperCase() + camelCase(str).slice(1);
  }

  function pgGetColumns(tablename, columns, cb) {
    var fields = ['table_catalog', 'table_schema', 'table_name', 'column_name', 'data_type'];
    // column_default, is_nullable
    var tpl = "SELECT " + fields.join(', ') + " FROM information_schema.columns WHERE table_name = %L";
    // table_schema = 'your_schema' AND
    var sql = format(tpl, tablename);

    if (debug) {
      console.log('psql 0');
      console.log(tpl);
      console.log(sql);
    }

    db.query(sql, earr, function (err, result) {
      if (err) {
        console.error('[Error] query columns');
        console.error(err.stack);
        cb(err);
        return;
      }

      // alternatively we could try this:
      // http://stackoverflow.com/questions/12597465/how-to-add-column-if-not-exists-on-postgresql
      if (false && debug) {
        console.log('psql rows 0');
        console.log(result);
      }

      function alterTable() {
        var column = columns.pop();
        var tpl;
        var sql;

        if (!column) {
          cb(null);
          return;
        }

        if (result.rows.some(function (row) {
          return row.column_name === snakeCase(column.name);
        })) {
          alterTable();
          return;
        }

        tpl = "ALTER TABLE %I ADD COLUMN %I %I DEFAULT null";
        sql = format(tpl, tablename, snakeCase(column.name), column.type);
        console.log('psql 1');
        console.log(tpl);
        console.log(sql);

        db.query(sql, earr, function (err, results) {
          if (err) {
            console.error("[Error] add column '" + tablename + "'");
            console.error(err.stack);
            cb(err);
            return;
          }

          if (debug) {
            console.log('psql rows 1');
            console.log(results);
          }

          alterTable();
        });
      }
      alterTable();
    });
  }

  function createTable(opts) {
    var DB = {};
    var tablename = (snakeCase(opts.tablename) || 'data');
    var idname = (snakeCase(opts.idname) || 'id');
    var idnameCased = (camelCase(opts.idname) || 'id');

    if (!opts.indices) {
      opts.indices = [];
    }
    opts.indices.forEach(function (col, i) {
      if ('string' === typeof col) {
        col = opts.indices[i] = { name: col, type: 'text' };
      }
      if (!col.type) {
        col.type = 'text';
      }
      col.type = col.type.toLowerCase(); // oh postgres...
      col.name = snakeCase(col.name);
    });


    db = PromiseA.promisifyAll(db);

    function simpleParse(row) {
      if (!row) {
        return null;
      }

      return simpleMap([row])[0] || null;
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
          delete row.json;
        } else {
          obj = {};
        }

        obj[idnameCased] = row[idname];
        delete row[idname];

        Object.keys(row).forEach(function (fieldname) {
          // TODO warn if overriding proper field? (shouldn't be possible)
          obj[camelCase(fieldname)] = row[fieldname];
        });

        return obj;
      });
      // set up for garbage collection
      rows.length = 0;
      rows = null;

      return results;
    }

    DB.find = function (opts, params) {
      var sql = format('SELECT * FROM %I ', tablename);
      var keys = opts && Object.keys(opts);

      if (opts && keys.length) {
        sql += 'WHERE ';

        keys.forEach(function (key, i) {
          if (i !== 0) {
            sql += 'AND ';
          }
          if (null === opts[key]) {
            sql += format('%I', snakeCase(key)) + " IS " + format('%L', opts[key]);
          } else {
            sql += format('%I', snakeCase(key)) + " = " + format('%L', opts[key]);
          }
        });
      }
      else if (null !== opts || (params && !params.limit)) {
        return PromiseA.reject(new Error("to find all you must explicitly specify find(null, { limit: <<int>> })"));
      }

      if (params) {
        if (params.orderBy) {
          sql += " ORDER BY " + format('%I', snakeCase(params.orderBy)) + " ";
          if (params.orderByDesc) {
            sql += 'DESC ';
          }
        }
        if (params.limit) {
          sql += " LIMIT " + parseInt(params.limit, 10);
        }
      }

      if (debug) {
        console.log('[dbwrap] find:');
        console.log(sql);
      }

      return db.queryAsync(sql, earr).then(function (result) {
        if (debug) {
          console.log('find result');
          console.log(result);
        }
        return simpleMap(result.rows);
      });
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
      if (!data) {
        data = id;
        id = data[idnameCased];
      }

      return DB.set(id, data).then(function (result) {
        var success = result.rowCount >= 1;

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
          //console.log('[debug result of set]', result.sql);
          delete result.sql;
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

        function sqlTpl(fieldable) {
          var fieldsql;
          var valuesql;
          var all = fieldable.slice(0);
          fieldsql = "INSERT INTO %I (" + all.map(function () { return '%I'; }).join(', ') + ", %I)";
          valuesql = " VALUES (" + all.map(function () { return '%%L'; }).join(", ") + ", %%L)";
          all.unshift(tablename);
          all.push(idname);

          if (debug) {
            console.log('[debug] create');
            console.log(fieldsql);
            console.log(valuesql);
            console.log(all);
          }
          return format.withArray(fieldsql + ' ' + valuesql, all);
        }

        // removes known fields from data
        sql = strainUpdate(id, data, sqlTpl);

        if (debug) {
          console.log('[debug] DB.create() sql:', sql);
        }
        db.query(sql, earr, function (err, result) {
          if (err) {
            reject(err);
            return;
          }

          if (debug) {
            console.log('this INSERT', this);
          }

          resolve(result);
        });
      });
    };

    // pull indices from object
    function strainUpdate(id, data/*, vals*/, cb) {
      var fieldable = [];
      var json;
      var sql;
      var vals = [];

      ['hasOne', 'hasMany', 'hasAndBelongsToMany', 'belongsTo', 'belongsToMany'].forEach(function (relname) {
        var rels = opts[relname];

        if (!rels) {
          return;
        }

        if (!Array.isArray(rels)) {
          rels = [rels];
        }

        // don't save relationships
        rels.forEach(function (colname) {
          delete data[colname];
          delete data[camelCase(colname)];
          // TODO placehold relationships on find / get?
          // data[camelCase(colname)] = null;
        });
      });

      opts.indices.forEach(function (col) {
        var val = data[camelCase(col.name)];

        //if (col.name in data)
        if ('undefined' !== typeof val) {
          fieldable.push(format('%I', snakeCase(col.name)));
          vals.push(val);
        }

        delete data[col.name];
        delete data[camelCase(col.name)];
      });

      delete data[idnameCased];

      if (!fieldable.length || Object.keys(data).length) {
        json = JSON.stringify(data);
        fieldable.push("json");
        vals.push(json);
      }

      vals.push(id);

      sql = cb(fieldable);
      sql = format.withArray(sql, vals);

      return sql;
    }

    DB.set = function (id, obj) {
      var json = JSON.stringify(obj);
      var data = JSON.parse(json);

      return new PromiseA(function (resolve, reject) {
        function sqlTpl(fieldable) {
          // this will always at least have one fieldable value: json
          return format("UPDATE %I SET "
            + (fieldable.join(' = %%L, ') + " = %%L")
            + " WHERE %I = %%L", tablename, idname)
            ;
        }

        //var vals = [];
        // removes known fields from data
        var sql = strainUpdate(id, data/*, vals*/, sqlTpl);

        //console.log('[debug] DB.set() sql:', sql);
        db.query(sql, /*vals*/[], function (err, result) {
          //console.log('[debug] error:', err);
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

          resolve(result);
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

        db.query(sql, values, function (err) {
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
      var escapable = [tablename];
      var indexable = [];
      var tpl;
      var sql;

      indexable.push('%I %I');
      escapable.push(idname);
      escapable.push('text DEFAULT NOT null');

      opts.indices.forEach(function (col) {
        indexable.push('%I %I DEFAULT null');
        escapable.push(snakeCase(col.name));
        escapable.push(col.type);
      });
      indexable.push('%I %I DEFAULT null');
      escapable.push('json');
      escapable.push('text');
      escapable.push(idname);

      tpl = 'CREATE TABLE IF NOT EXISTS %I (' + indexable.join(', ') + ', PRIMARY KEY(%I))';
      sql = format.withArray(tpl, escapable);

      if (debug) {
        console.log('psql');
        console.log(tpl);
        console.log(sql);
      }
      db.query(sql, earr, function (err, rows) {
        if (err) {
          console.error('[Error] dbwrap create table');
          console.error(err.stack);
          reject(err);
          return;
        }

        pgGetColumns(tablename, opts.indices, function (err) {
          if (err) {
            console.error('[Error] dbwrap get columns');
            console.error(err.stack);
            reject(err);
            return;
          }

          resolve(DB);
        });
      });
    });
  }

  dir.forEach(function (opts) {
    promises.push(createTable(opts).then(function (dbw) {
      var modelname = opts.modelname;

      if (!modelname) {
        modelname = (opts.tablename || 'data');
        modelname = upperCamelCase(modelname);
      }

      dbsMap[modelname] = dbw;

      return dbw;
    }));
  });

  dbsMap.sql = db;

  return PromiseA.all(promises).then(function (/*dbs*/) {
    return dbsMap;
  });
}

module.exports.wrap = wrap;
