'use strict';

var PromiseA = require('bluebird').Promise;

function testDb(DB) {
  return PromiseA.resolve(DB).then(function (DB) {
    var data = { secret: 'super secret', verifiedAt: 1437207288791 };
    //return DB.set('aj@the.dj', data)
    //return DB.set('john.doe@email.com', data)
    // return DB.upsert('jane.doe@email.com', data)
    return DB.upsert('jane.doe@email.com', data).then(function () {
      console.info('[PASS] added user');
    });

    /*
    return DB.create('john.doe@email.com', data).then(function () {
      console.log('added user');
    });
    */

    // need to 'DELETE FROM authn;' first
    return DB.get('john.doe@email.com').then(function (user) {
      if (user) {
        console.info('user', user);
        return;
      }

      //var data = { secret: 'super secret', verifiedAt: Date.now() };
      var data = { secret: 'super secret', verifiedAt: 1437207288790 };
      return DB.create('john.doe@email.com', data).then(function () {
        console.info('added user');
      });

    });
  }).then(function () {}, function (err) {
    // code SQLITE_CONSTRAINT
    // errno 19

    console.error('[ERROR] during test');
    //console.error(Object.keys(err)); // errno, code
    console.error(err);
  });
}

function run(/*isMaster*/) {
  require('./setup').run().then(testDb);

  /*
  if (require.main === module) {
    // crypto.randomBytes(16).toString('hex');
    create({
      key: '1892d335081d8d346e556c9c3c8ff2c3'
    , bits: 128
    , filename: '/tmp/authn.sqlcipher'
    }).then(function (DB) {
    });
  }
  */
}

run();
