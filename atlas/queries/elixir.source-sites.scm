[
  (call)
  (access_call)
] @source.site.call
(call
  target: (identifier) @source.form
  (arguments (alias) @source.specifier.literal.alias)
  (#eq? @source.form "alias")) @source.site.alias
(call
  target: (identifier) @source.form
  (arguments (alias) @source.specifier.literal.use)
  (#eq? @source.form "use")) @source.site.use
(call
  target: (identifier) @source.form
  (arguments (alias) @source.specifier.literal.static-import)
  (#eq? @source.form "import")) @source.site.static-import
