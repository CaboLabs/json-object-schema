package org.oojs.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** An OOJS type definition. */
public final class TypeDef {
    public final String name;
    public final String schemaId;
    public final boolean abstractType;
    public final String extendsName;
    public final String discriminatorValue;
    public final String title;
    public final String description;

    public Map<String, PropertyDef> ownProperties = new LinkedHashMap<>();
    public List<String> ownRequired = new ArrayList<>();
    public TypeDef supertype = null;

    public TypeDef(String name, String schemaId, boolean abstractType, String extendsName,
            String discriminatorValue, String title, String description) {
        this.name = name;
        this.schemaId = schemaId;
        this.abstractType = abstractType;
        this.extendsName = extendsName;
        this.discriminatorValue = discriminatorValue;
        this.title = title;
        this.description = description;
    }

    public String getEffectiveDiscriminatorValue() {
        return discriminatorValue != null ? discriminatorValue : name;
    }

    public List<String> effectiveRequired() {
        if (supertype == null) return Collections.unmodifiableList(ownRequired);
        List<String> result = new ArrayList<>(supertype.effectiveRequired());
        result.addAll(ownRequired);
        return result;
    }

    public Map<String, PropertyDef> effectiveProperties() {
        if (supertype == null) return Collections.unmodifiableMap(ownProperties);
        Map<String, PropertyDef> result = new LinkedHashMap<>(supertype.effectiveProperties());
        result.putAll(ownProperties);
        return result;
    }

    public boolean isSubtypeOf(TypeDef other) {
        TypeDef current = this;
        while (current != null) {
            if (current == other) return true;
            current = current.supertype;
        }
        return false;
    }
}
