package org.oojs.model;

import java.util.List;

/** A property whose value is one of the JSON primitive types: string, integer, number, boolean, null. */
public final class PrimitiveProperty implements PropertyDef {
    public final String kind;
    public final String title;
    public final String description;
    public final Integer minLength;
    public final Integer maxLength;
    public final String pattern;
    public final String format;
    public final Double minimum;
    public final Double maximum;
    public final Double exclusiveMinimum;
    public final Double exclusiveMaximum;
    public final Double multipleOf;
    public final List<Object> enumValues;

    public PrimitiveProperty(String kind, String title, String description,
            Integer minLength, Integer maxLength, String pattern, String format,
            Double minimum, Double maximum, Double exclusiveMinimum, Double exclusiveMaximum,
            Double multipleOf, List<Object> enumValues) {
        this.kind = kind;
        this.title = title;
        this.description = description;
        this.minLength = minLength;
        this.maxLength = maxLength;
        this.pattern = pattern;
        this.format = format;
        this.minimum = minimum;
        this.maximum = maximum;
        this.exclusiveMinimum = exclusiveMinimum;
        this.exclusiveMaximum = exclusiveMaximum;
        this.multipleOf = multipleOf;
        this.enumValues = enumValues;
    }
}
