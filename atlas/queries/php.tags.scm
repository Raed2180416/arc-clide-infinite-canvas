(namespace_definition name: (namespace_name) @name) @definition.module
(interface_declaration name: (name) @name) @definition.interface
(trait_declaration name: (name) @name) @definition.trait
(class_declaration name: (name) @name) @definition.class
(enum_declaration name: (name) @name) @definition.enum
(property_declaration
  (property_element (variable_name (name) @name))) @definition.property
(function_definition name: (name) @name) @definition.function
(method_declaration name: (name) @name) @definition.method
