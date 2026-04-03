package org.oojs.model;

/**
 * A property that holds a string ID referencing another typed object (§6.4).
 *
 * <p>In JSON instances the value is a plain string (the ID). The validator
 * checks the value is a string but does NOT follow or validate the referenced
 * object. The target type is resolved eagerly at load time (pass 3).
 *
 * <p>{@code resolvedType} is populated by the Registry during pass 3. It is
 * {@code null} only between initial parsing and resolution; after a successful
 * schema load it is always set.
 */
public final class IdRefProperty implements PropertyDef {
    public final String typeName;
    public String title;
    public String description;
    public Integer minLength;
    public Integer maxLength;
    public String pattern;

    /** Resolved at load time by Registry. Never null after successful schema load. */
    public TypeDef resolvedType = null;

    public IdRefProperty(String typeName) {
        this.typeName = typeName;
        this.title = "";
        this.description = "";
    }
}
