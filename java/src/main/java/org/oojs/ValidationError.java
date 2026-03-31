package org.oojs;

/** A single instance-validation error. */
public final class ValidationError {
    public final String path;
    public final String code;
    public final String message;

    public ValidationError(String path, String code, String message) {
        this.path = path;
        this.code = code;
        this.message = message;
    }

    @Override
    public String toString() {
        return path + ": [" + code + "] " + message;
    }
}
