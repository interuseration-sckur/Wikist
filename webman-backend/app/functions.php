<?php
/**
 * Here is your custom functions.
 */

if (!function_exists('wikist_env_bool')) {
    function wikist_env_bool(string $name, bool $default = false): bool
    {
        $value = getenv($name);
        if ($value === false || $value === '') {
            return $default;
        }
        return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
    }
}

if (!function_exists('wikist_env_list')) {
    /** @return list<string> */
    function wikist_env_list(string $name, array $default = []): array
    {
        $value = getenv($name);
        if ($value === false || trim($value) === '') {
            return $default;
        }
        return array_values(array_filter(array_map('trim', explode(',', $value))));
    }
}
