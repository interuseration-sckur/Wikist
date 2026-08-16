<?php

namespace app\service;

final class OperationalMetrics
{
    private static array $requests = ['total' => 0, 'errors' => 0, 'total_ms' => 0.0, 'max_ms' => 0.0];
    private static array $sqlite = ['busy_total' => 0, 'write_retry_total' => 0, 'write_count' => 0, 'write_duration_ms' => 0.0, 'write_max_ms' => 0.0];

    public static function request(float $durationMs, int $status): void
    {
        self::$requests['total']++;
        self::$requests['total_ms'] += max(0, $durationMs);
        self::$requests['max_ms'] = max(self::$requests['max_ms'], $durationMs);
        if ($status >= 500) self::$requests['errors']++;
    }

    public static function sqliteWrite(float $durationMs, int $retries = 0, bool $busy = false): void
    {
        self::$sqlite['write_count']++;
        self::$sqlite['write_duration_ms'] += max(0, $durationMs);
        self::$sqlite['write_max_ms'] = max(self::$sqlite['write_max_ms'], $durationMs);
        self::$sqlite['write_retry_total'] += max(0, $retries);
        if ($busy) self::$sqlite['busy_total']++;
    }

    public static function sqliteBusy(): void
    {
        self::$sqlite['busy_total']++;
    }

    public static function snapshot(): array
    {
        $requests = self::$requests;
        $sqlite = self::$sqlite;
        return [
            'requests' => [
                'total' => $requests['total'],
                'errors' => $requests['errors'],
                'avgMs' => $requests['total'] ? round($requests['total_ms'] / $requests['total'], 2) : 0,
                'maxMs' => round($requests['max_ms'], 2),
            ],
            'sqlite' => [
                'sqlite_busy_total' => $sqlite['busy_total'],
                'sqlite_write_retry_total' => $sqlite['write_retry_total'],
                'sqlite_write_count' => $sqlite['write_count'],
                'sqlite_write_duration_ms' => round($sqlite['write_duration_ms'], 2),
                'sqlite_write_max_ms' => round($sqlite['write_max_ms'], 2),
            ],
            'privacy' => '仅保留当前进程聚合值，不记录账号、IP、SQL、正文或查询词。',
        ];
    }
}
