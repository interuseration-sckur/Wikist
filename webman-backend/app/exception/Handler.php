<?php

namespace app\exception;

use app\http\ApiResponse;
use app\service\SensitiveDataRedactor;
use app\service\OperationalMetrics;
use Throwable;
use Webman\Exception\ExceptionHandler;
use Webman\Http\Request;
use Webman\Http\Response;

final class Handler extends ExceptionHandler
{
    public $dontReport = [ApiException::class];

    public function report(Throwable $exception): void
    {
        if ($this->shouldntReport($exception)) {
            return;
        }
        $request = request();
        $requestId = is_object($request) ? (string) ($request->requestId ?? '') : '';
        $method = is_object($request) ? (string) $request->method() : '';
        $path = is_object($request) ? (string) $request->path() : '';
        $message = SensitiveDataRedactor::text($exception->getMessage());
        $trace = SensitiveDataRedactor::text($exception->getTraceAsString());
        $this->logger->error('Unhandled Wikist request error', [
            'requestId' => $requestId,
            'method' => $method,
            'path' => $path,
            'exception' => get_class($exception),
            'message' => $message,
            'file' => basename($exception->getFile()),
            'line' => $exception->getLine(),
            'trace' => $trace,
        ]);
    }

    public function render(Request $request, Throwable $exception): Response
    {
        if ($exception instanceof ApiException) {
            $response = ApiResponse::error(
                $exception->getMessage(),
                $exception->status(),
                $exception->errorCode(),
                $exception->details(),
            )->header('X-Request-Id', (string) ($request->requestId ?? ''));
            if ($exception->status() === 429 && isset($exception->details()['retryAfter'])) {
                $response = $response->header('Retry-After', (string) max(1, (int) $exception->details()['retryAfter']));
            }
            return $response;
        }
        if ($this->debug) {
            return parent::render($request, $exception);
        }
        if (method_exists($exception, 'render') && ($response = $exception->render($request))) {
            return $response;
        }
        $requestId = (string) ($request->requestId ?? '');
        $databaseBusy = preg_match('/SQLITE_BUSY|database is locked|database table is locked/iu', $exception->getMessage()) === 1;
        if ($databaseBusy) OperationalMetrics::sqliteBusy();
        $status = $databaseBusy ? 503 : 500;
        if ($request->expectsJson() || str_starts_with($request->path(), '/api/')) {
            return json([
                'error' => $databaseBusy ? '数据库繁忙，请稍后重试。' : '服务器暂时无法处理该请求。',
                'code' => $databaseBusy ? 'database_busy' : 'server_error',
                'requestId' => $requestId,
            ], JSON_UNESCAPED_UNICODE)->withStatus($status)->withHeader('Retry-After', $databaseBusy ? '1' : '0');
        }
        $safeId = htmlspecialchars($requestId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        return new Response($status, ['Content-Type' => 'text/html; charset=utf-8', 'Retry-After' => $databaseBusy ? '1' : '0'],
            '<!doctype html><meta charset="utf-8"><title>Wikist 请求失败</title>'
            . '<main style="max-width:42rem;margin:12vh auto;padding:2rem;font:16px/1.7 system-ui">'
            . '<h1>请求暂时无法完成</h1><p>请稍后重试。请求编号：<code>' . $safeId . '</code></p></main>'
        );
    }
}
