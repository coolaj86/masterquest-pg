Master Quest
------------

An ORM for multi-master applications.

It is assumed that relationships are tight and therefore should be prefetched and that data is often added,
but rarely updated (append/log-style over traditional update style).

API
---

* save(data) - creates or updates based on presence of ID
* upsert(id, data) - creates or updates based on existence in DB
* destroy(id) - deletes from DB
* get(id) - grab one by id
* find(attrs, opts) - grab many by indexable attributes
  * opts.orderBy
  * opts.orderByDesc

maybe?

* where(sql, vals) - WHERE
