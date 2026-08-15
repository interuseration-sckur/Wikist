<?php

namespace app\repository;

final class SiteConfigRepository
{
    private static int $mtime = -1;
    private static array $config = [];

    public function all(): array
    {
        $path = base_path('../config/site.config.json');
        $mtime = is_file($path) ? (int) filemtime($path) : 0;
        if ($mtime !== self::$mtime) {
            $decoded = $mtime > 0 ? json_decode((string) file_get_contents($path), true) : [];
            self::$config = is_array($decoded) ? $decoded : [];
            self::$mtime = $mtime;
        }
        return self::$config;
    }

    public function get(string $path, mixed $default = null): mixed
    {
        $value = $this->all();
        foreach (explode('.', $path) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }
        return $value;
    }
}
