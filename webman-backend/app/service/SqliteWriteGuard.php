<?php

namespace app\service;

use Illuminate\Database\ConnectionInterface;
use Throwable;

final class SqliteWriteGuard
{
    public static function idempotent(ConnectionInterface $connection, callable $callback, int $maxAttempts = 3): mixed
    {
        $started = hrtime(true);
        $driver = strtolower((string) ($connection->getConfig('driver') ?: ''));
        $attempts = 0;
        $busy = false;
        $insideTransaction = method_exists($connection, 'transactionLevel') && $connection->transactionLevel() > 0;
        $limit = $driver === 'sqlite' && !$insideTransaction ? max(1, min(4, $maxAttempts)) : 1;
        while (true) {
            $attempts++;
            try {
                $result = $callback();
                OperationalMetrics::sqliteWrite((hrtime(true) - $started) / 1_000_000, $attempts - 1, $busy);
                return $result;
            } catch (Throwable $error) {
                $locked = preg_match('/SQLITE_BUSY|database is locked|database table is locked/iu', $error->getMessage()) === 1;
                if (!$locked || $attempts >= $limit) {
                    if ($locked) OperationalMetrics::sqliteBusy();
                    throw $error;
                }
                $busy = true;
                usleep(random_int(15_000, 55_000) * $attempts);
            }
        }
    }
}
