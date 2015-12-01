Master Quest SQLite3
============

Master Quest is a brave new attempt at Data Mapping.

It kinda looks like an ORM, but it isn't. It's not SQL, it's NoSQL with benefits.

You get to choose which contraints to keep and which to forget.

Guiding Principles

* NoSQL (well, as far as you care)
* Migrations don't suck
* Harness the awesomeness of indexes
* `deletedAt` to delete a record
* `null` to delete a field
* unindexed fields stored as json
* ids should be one either
  * deterministic (duplicate records not okay, last `updatedAt` wins)
  * cryptographically random (duplicate records consolidated in application)
* avoid mutating data (CRDT-ish style)
* if it won't scale, don't fret it (no foreign key contraints)
* `id` is simply named `id`
* multi-key ids should be `sha256sum(key1 + key2 + key3)`
* JavaScript is `camelCase`y, databases are `snake_case`y. We can handle that.
* join tables are in alphabet order i.e. `foo`, `bar`, `bar_foo`

TODO / In Progress

* Multi-Master Replication
* Relationships
  * currently detaches before saving (most important)
* MongoDB / RethinkDB -ish queries
* RealTime

USAGE
=====

```bash
npm install --save 'https://github.com/coolaj86/node-masterquest-sqlite3.git'
```

```javascript
'use strict';

// works with sqlite3, sqlcipher, and sqlite3-cluster
var db = new (require('sqlite3').Database)('/tmp/data.sqlite3');

require('masterquest-sqlite3').wrap(db, {
  modelname: 'Persons'
, indices: [ 'firstName', 'lastName' ]
, hasMany: [ 'children' ]
}).then(function (mq) {

  // update (or create) deterministic record
  var john = {
    id: 'john.doe@email.com'
  , firstName: 'john'
  , lastName: 'doe'
  , dog: { name: 'ralph', color: 'gold' }
  , children: [ 'stacey@email.com' ]
  };

  mq.Persons.upsert(john.id, john).then(function () {
    // note: if `dog` existed, it will be overwritten, not merged
    // note: `children` will be removed before save

    mq.Persons.get('john.doe@email.com').then(function (data) {
      // dog will be rehydrated from json
      // children will not be fetched and attached
      console.log(data);
    });

  });

});
```

API
===

It's kinda CRUDdy... but don't let that scare you.

* `upsert(id, data)` - creates or updates based on existence in DB (use this)
  * modifies `createdAt` and or `updatedAt`
* `save(data)` - (just don't use this, please) creates or updates based on presence of ID
* `destroy(id)` - mark a record as `deletedAt` from DB
* `get(id)` - grab one by id
* `find(attrs, opts)` - grab many by indexable attributes
  * attrs
    * explicit `null` will find all (and requires that `limit` be set)
    * `{ foo: 2, bar: 6 }` will find records where `foo` is `2` *and* `bar` is `6`
  * opts
    * `orderBy`
    * `orderByDesc`
    * `limit`

Schema
======

Anything that isn't in the schema

* `indices` specifies an array of strings
  * `[ 'firstName', 'lastName' ]`
* relationships are option and current only exclude during save
  * `hasMany`, `belongsTo`, `hasOne`, `belongsToMany`, `hasAndBelongsToMany`
* `createdAt`, `updatedAt`, `deletedAt` timestamps are always added
  * turn off with `timestamps: false`
* `id` is always `id`
  * change with `idname: 'myId'`

Migrations
----------

You can only add indexes. You cannot rename or remove them.

To add an index, simply change the schema.

```javascript
{ modelname: 'persons'
, indices: [ 'firstName', 'lastName' ]
, hasMany: [ 'children' ]
}
```

LICENSE
=======

Dual-licensed MIT and Apache-2.0

See LICENSE
