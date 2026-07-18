// Correr com: node --env-file=.env server/scripts/check-schema.js
const mssql = require('../services/mssql');

(async () => {
  console.log('A verificar ligacao e esquema do SQL Server...');
  const problems = await mssql.checkSchema();
  if (problems.length === 0) {
    console.log('OK: esquema compativel. Funcionalidade de mesas pode ser ativada.');
    process.exit(0);
  }
  console.log('PROBLEMAS ENCONTRADOS:');
  problems.forEach((p) => console.log(`  - ${p}`));
  console.log('');
  console.log('A funcionalidade de mesas ficara desativada ate estes problemas serem resolvidos.');
  process.exit(1);
})();
