const CloudBase = require('@cloudbase/manager-node');
const { createRegistrationHandler, sqlLiteral, parseSqlJson } = require('./register.cjs');

// Manager SDK reads CloudBase-injected temporary credentials at request time.
// Never put a persistent administrator key in source, configuration, or the client.
exports.main = async event => {
  const app = new CloudBase({ envId: process.env.HCLAB_ENV_ID, region: 'ap-shanghai' });
  const handler = createRegistrationHandler({
    reportError: error => console.error(JSON.stringify({ event: 'registration_failed', code: error.code || 'BACKEND_ERROR', requestId: error.requestId || null })),
    claim: async data => parseSqlJson(await app.database.executePGSql({
      Sql: `select private.claim_registration(${sqlLiteral(JSON.stringify(data))}::jsonb)`,
    })),
    createUser: data => app.user.createUser(data),
    finish: async token => parseSqlJson(await app.database.executePGSql({
      Sql: `select private.finish_registration(${sqlLiteral(token)}::uuid)`,
    })),
  });
  return handler(event);
};
