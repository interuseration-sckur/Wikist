<?php

namespace app\controller;

use support\Request;
use support\Response;
use Workerman\Protocols\Http\Chunk;
use Workerman\Timer;

final class SseController
{
    public function stream(Request $request): Response
    {
        $connection = $request->connection;
        $userId = $request->identity->id;
        $started = time();
        $timer = null;
        $timer = Timer::add(10, function () use ($connection, $userId, $started, &$timer): void {
            if (time() - $started >= 55) {
                Timer::del($timer);
                $connection->send(new Chunk("event: reconnect\ndata: {}\n\n"));
                $connection->send(new Chunk(''));
                return;
            }
            $connection->send(new Chunk(': heartbeat ' . $userId . "\n\n"));
        });
        Timer::add(0.01, static function () use ($connection, $userId): void {
            $payload = json_encode(['type' => 'connected', 'userId' => $userId], JSON_UNESCAPED_UNICODE);
            $connection->send(new Chunk("event: ready\ndata: {$payload}\n\n"));
        }, [], false);
        $connection->onClose = static function () use (&$timer): void {
            if ($timer !== null) {
                Timer::del($timer);
            }
        };
        return response('', 200, [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
            'Transfer-Encoding' => 'chunked',
        ]);
    }
}
