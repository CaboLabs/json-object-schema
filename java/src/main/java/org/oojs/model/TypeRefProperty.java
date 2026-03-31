package org.oojs.model;

/** A property whose value is an object conforming to another named type. */
public final class TypeRefProperty implements PropertyDef {
    public final String typeName;
    public final String title;
    public final String description;

    public TypeRefProperty(String typeName, String title, String description) {
        this.typeName = typeName;
        this.title = title;
        this.description = description;
    }
}
