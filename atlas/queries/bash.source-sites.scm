(command) @source.site.call
(command
  name: (command_name (word) @source.form)
  argument: (word) @source.specifier.literal.source
  (#any-of? @source.form "source" ".")) @source.site.source
