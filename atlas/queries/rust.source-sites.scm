(call_expression) @source.site.call
(macro_invocation) @source.site.call
(use_declaration
  argument: (_) @source.specifier.literal.use) @source.site.use
(mod_item
  name: (identifier) @source.specifier.literal.module-declaration) @source.site.module-declaration
(macro_invocation
  macro: (identifier) @source.form
  (token_tree
    (string_literal) @source.specifier.literal.include)
  (#eq? @source.form "include")) @source.site.include
