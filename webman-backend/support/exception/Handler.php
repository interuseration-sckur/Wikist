<?php

namespace support\exception;

use app\exception\ApiException;
use app\http\ApiResponse;
use Throwable;
use Webman\Exception\ExceptionHandler;
use Webman\Http\Request;
use Webman\Http\Response;

final class Handler extends ExceptionHandler
{
    public $dontReport = [ApiException::class];

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
        if (str_starts_with($request->path(), '/api/')) {
            $message = config('app.debug') ? $exception->getMessage() : '服务暂时不可用。';
            return ApiResponse::error($message, 500, 'internal_error')
                ->header('X-Request-Id', (string) ($request->requestId ?? ''));
        }
        return parent::render($request, $exception);
    }
}
