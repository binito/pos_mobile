const { createServer } = require('./server');
const { startTableWatcher } = require('./services/tableWatcher');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer();
startTableWatcher();

function shutdown(signal) {
  console.log(`Recebido ${signal}; a fechar servidor HTTP.`);
  server.close((error) => {
    if (error) {
      console.error('Erro ao fechar servidor:', error);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Timeout no shutdown; a sair.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  shutdown('unhandledRejection');
});

server.listen(PORT, HOST, () => {
  console.log(`POS mobile a correr em http://${HOST}:${PORT}`);
  console.log(`Produtos: MariaDB ${process.env.MARIADB_DATABASE || 'zonesoft_full'} @ ${process.env.MARIADB_HOST || 'localhost'}`);
});
