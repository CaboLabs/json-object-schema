package org.oojs.model;

/**
 * A property whose value is an object conforming to another named type.
 *
 * <p>{@code resolvedType} is populated by the Registry during the eager
 * type-reference resolution pass (§10.2 step 5 / Appendix A.3). It is
 * {@code null} only between initial parsing and resolution; after a
 * successful schema load it is always set.
 */
public final class TypeRefProperty implements PropertyDef {
    public final String typeName;
    public final String title;
    public final String description;

    /** Resolved at load time by Registry. Never null after successful schema load. */
    public TypeDef resolvedType = null;

    public TypeRefProperty(String typeName, String title, String description) {
        this.typeName = typeName;
        this.title = title;
        this.description = description;
    }
}
