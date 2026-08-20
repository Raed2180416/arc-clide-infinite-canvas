(call) @source.site.call
(call
  method: (identifier) @source.form
  arguments: (argument_list (string) @source.specifier.literal.require)
  (#eq? @source.form "require")) @source.site.require
(call
  method: (identifier) @source.form
  arguments: (argument_list (string) @source.specifier.literal.source)
  (#eq? @source.form "require_relative")) @source.site.source
(call
  method: (identifier) @source.form
  arguments: (argument_list (string) @source.specifier.literal.load)
  (#eq? @source.form "load")) @source.site.load
