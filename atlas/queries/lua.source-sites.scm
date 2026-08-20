(function_call) @source.site.call
(function_call
  name: (identifier) @source.form
  arguments: (arguments (string) @source.specifier.literal.require)
  (#eq? @source.form "require")) @source.site.require
(function_call
  name: (identifier) @source.form
  arguments: (arguments (string) @source.specifier.literal.load)
  (#any-of? @source.form "load" "loadfile" "dofile")) @source.site.load
