<?php

declare(strict_types=1);

namespace Oojs;

/**
 * A single instance-validation error.
 *
 * @property string $path    JSON Pointer (RFC 6901) to the failing location
 * @property string $code    One of the ErrorCode constants
 * @property string $message Human-readable description
 */
class ValidationError
{
    public function __construct(
        public readonly string $path,
        public readonly string $code,
        public readonly string $message,
    ) {}

    public function __toString(): string
    {
        return "{$this->path}: [{$this->code}] {$this->message}";
    }
}
