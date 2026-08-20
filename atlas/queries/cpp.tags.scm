(namespace_definition name: (namespace_identifier) @name) @definition.module
(struct_specifier name: (type_identifier) @name body: (_)) @definition.struct
(union_specifier name: (type_identifier) @name body: (_)) @definition.union
(class_specifier name: (type_identifier) @name body: (_)) @definition.class
(enum_specifier name: (type_identifier) @name body: (_)) @definition.enum
(type_definition declarator: (type_identifier) @name) @definition.type
(function_declarator declarator: (identifier) @name) @definition.function
(function_declarator declarator: (field_identifier) @name) @definition.method
(function_declarator
  declarator: (qualified_identifier name: (identifier) @name)) @definition.method
