<?php

namespace app\controller;

use app\http\ApiResponse;
use app\service\OperationalMetrics;
use support\Db;
use support\Request;
use support\Response;
use Throwable;

final class HealthController
{
    public function index(Request $request): Response
    {
        $database = ['status' => 'ok'];
        $status = 'ok';
        try {
            Db::connection('wikist')->select('SELECT 1');
        } catch (Throwable $error) {
            $status = 'degraded';
            $database = ['status' => 'error', 'message' => config('app.debug') ? $error->getMessage() : 'database unavailable'];
        }
        return ApiResponse::data([
            'ok' => $status === 'ok',
            'status' => $status,
            'service' => 'wikist-webman',
            'version' => '1.0.1',
            'runtime' => ['php' => PHP_VERSION, 'webman' => '2.2'],
            'components' => [
                'database' => $database,
                'passport' => ['owner' => 'webman', 'database' => 'wikist'],
                'community' => ['owner' => 'webman'],
                'messaging' => ['owner' => 'webman'],
                'legacyProxy' => ['owner' => 'node-compatibility', 'enabled' => (bool) config('wikist.legacy_proxy.enabled'), 'scope' => 'unported-api-only'],
                'realtime' => ['owner' => 'centrifugo-transport', 'enabled' => (bool) config('wikist.realtime.enabled')],
            ],
            'metrics' => OperationalMetrics::snapshot(),
            'requestId' => $request->requestId,
        ], $status === 'ok' ? 200 : 503);
    }

    public function ready(Request $request): Response
    {
        return $this->index($request);
    }

    public function live(Request $request): Response
    {
        return ApiResponse::data([
            'ok' => true,
            'status' => 'alive',
            'service' => 'wikist-webman',
            'requestId' => $request->requestId,
        ]);
    }
}
