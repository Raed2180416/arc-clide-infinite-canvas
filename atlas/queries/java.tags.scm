(package_declaration (scoped_identifier) @name) @definition.module
(package_declaration (identifier) @name) @definition.module
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum
(record_declaration name: (identifier) @name) @definition.record
(annotation_type_declaration name: (identifier) @name) @definition.annotation
(constructor_declaration name: (identifier) @name) @definition.constructor
(method_declaration name: (identifier) @name) @definition.method
(field_declaration
  declarator: (variable_declarator name: (identifier) @name)) @definition.field
