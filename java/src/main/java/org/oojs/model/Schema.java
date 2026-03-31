package org.oojs.model;

import java.util.LinkedHashMap;
import java.util.Map;

/** An OOJS schema document (one per $id). */
public final class Schema {
    public final String oojsVersion;
    public final String schemaId;
    public final String title;
    public final String description;
    public final String discriminator;
    public final boolean closedWorld;

    public Map<String, String> imports = new LinkedHashMap<>();
    public Map<String, TypeDef> types = new LinkedHashMap<>();

    public Schema(String oojsVersion, String schemaId, String title, String description,
            String discriminator, boolean closedWorld) {
        this.oojsVersion = oojsVersion;
        this.schemaId = schemaId;
        this.title = title;
        this.description = description;
        this.discriminator = discriminator;
        this.closedWorld = closedWorld;
    }
}
