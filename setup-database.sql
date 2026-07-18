-- Cria um login SQL dedicado e de privilegios minimos para o pos_online.
-- Corre com: sqlcmd -S <instancia> -E -v LoginName="pos_online_svc" LoginPassword="..." DatabaseName="zsrest_2024_0" -i setup-database.sql
-- Requer que "SQL Server and Windows Authentication mode" esteja ativo na instancia.

USE master;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$(LoginName)')
BEGIN
    DECLARE @sql NVARCHAR(MAX) = N'CREATE LOGIN [' + '$(LoginName)' + N'] WITH PASSWORD = ''' + '$(LoginPassword)' + N''', CHECK_POLICY = OFF';
    EXEC sp_executesql @sql;
END
ELSE
BEGIN
    DECLARE @sql2 NVARCHAR(MAX) = N'ALTER LOGIN [' + '$(LoginName)' + N'] WITH PASSWORD = ''' + '$(LoginPassword)' + N'''';
    EXEC sp_executesql @sql2;
END

USE [$(DatabaseName)];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$(LoginName)')
BEGIN
    DECLARE @sql3 NVARCHAR(MAX) = N'CREATE USER [' + '$(LoginName)' + N'] FOR LOGIN [' + '$(LoginName)' + N']';
    EXEC sp_executesql @sql3;
END

DECLARE @grants NVARCHAR(MAX) = N'
GRANT SELECT ON dbo.produtos TO [' + '$(LoginName)' + N'];
GRANT SELECT ON dbo.familias TO [' + '$(LoginName)' + N'];
GRANT SELECT ON dbo.mapamesas TO [' + '$(LoginName)' + N'];
GRANT SELECT, INSERT, DELETE ON dbo.consumo TO [' + '$(LoginName)' + N'];
';
EXEC sp_executesql @grants;

SELECT 'POS_ONLINE_DB_LOGIN_PRONTO' AS status;
