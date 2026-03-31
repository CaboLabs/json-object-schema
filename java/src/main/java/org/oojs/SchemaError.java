package org.oojs;

/** Thrown when a schema document is structurally invalid. */
public class SchemaError extends RuntimeException {
    public SchemaError(String message) {
        super(message);
    }
}
