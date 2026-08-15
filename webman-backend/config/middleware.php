<?php

return [
    '' => [
        app\middleware\RequestContextMiddleware::class,
        app\middleware\TrustedOriginMiddleware::class,
        app\middleware\AuthContextMiddleware::class,
        app\middleware\SecurityHeadersMiddleware::class,
    ],
];
