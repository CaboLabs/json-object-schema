package org.oojs.model;

/** A property whose value is a JSON array with homogeneous items. Nested arrays are not supported in v1.0. */
public final class ArrayProperty implements PropertyDef {
    public final PropertyDef items;
    public final int minItems;
    public final Integer maxItems;
    public final boolean uniqueItems;
    public final String title;
    public final String description;

    public ArrayProperty(PropertyDef items, int minItems, Integer maxItems,
            boolean uniqueItems, String title, String description) {
        this.items = items;
        this.minItems = minItems;
        this.maxItems = maxItems;
        this.uniqueItems = uniqueItems;
        this.title = title;
        this.description = description;
    }
}
