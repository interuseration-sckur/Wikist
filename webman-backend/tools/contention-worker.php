<?php

declare(strict_types=1);

[$script, $database, $worker, $loops] = array_pad($argv, 4, '');
$pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]);
$pdo->exec('PRAGMA busy_timeout=10000');
$pdo->exec('PRAGMA foreign_keys=ON');
$busy = 0;
for ($index = 0; $index < (int) $loops; $index++) {
    for ($attempt = 1; ; $attempt++) {
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare("INSERT INTO contention_members (worker_id, value, updated_at) VALUES (?, 1, ?) ON CONFLICT(worker_id) DO UPDATE SET value=value+1, updated_at=excluded.updated_at");
            $statement->execute([(int) $worker, gmdate('c')]);
            $pdo->commit();
            break;
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $locked = preg_match('/SQLITE_BUSY|database is locked|database table is locked/i', $error->getMessage()) === 1;
            if (!$locked || $attempt >= 4) throw $error;
            $busy++;
            usleep(random_int(10000, 40000) * $attempt);
        }
    }
}
echo json_encode(['ok' => true, 'worker' => (int) $worker, 'busyRetries' => $busy]) . PHP_EOL;
