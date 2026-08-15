<?php

require __DIR__ . '/database.php';

['pdo' => $pdo, 'driver' => $driver] = wikist_database();
$schema = file_get_contents(dirname(__DIR__) . "/database/schema/wikist.{$driver}.sql");
if ($schema === false) {
    throw new RuntimeException("Missing schema for {$driver}");
}
$pdo->exec($schema);
$statement = $pdo->prepare($driver === 'sqlite'
    ? 'INSERT OR IGNORE INTO webman_migrations (migration, applied_at) VALUES (?, ?)'
    : 'INSERT IGNORE INTO webman_migrations (migration, applied_at) VALUES (?, ?)');
$statement->execute(['0001_passport_foundation', gmdate('c')]);

$migrations = glob(dirname(__DIR__) . '/database/migrations/*.php') ?: [];
sort($migrations, SORT_STRING);
$applied = $pdo->query('SELECT migration FROM webman_migrations')?->fetchAll(PDO::FETCH_COLUMN) ?: [];
$applied = array_fill_keys(array_map('strval', $applied), true);
foreach ($migrations as $file) {
    $name = pathinfo($file, PATHINFO_FILENAME);
    if (isset($applied[$name])) {
        continue;
    }
    $migration = require $file;
    if (!is_callable($migration)) {
        throw new RuntimeException("Migration {$name} must return a callable.");
    }
    $pdo->beginTransaction();
    try {
        $migration($pdo, $driver);
        $statement->execute([$name, gmdate('c')]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw new RuntimeException("Migration {$name} failed: {$error->getMessage()}", 0, $error);
    }
}
echo "Wikist schema is ready ({$driver})." . PHP_EOL;
