(call
  target: (identifier) @form
  (arguments (alias) @name)
  (#any-of? @form "defmodule" "defprotocol" "defimpl")) @definition.module

(call
  target: (identifier) @form
  (arguments
    [
      (identifier) @name
      (call target: (identifier) @name)
      (binary_operator
        left: (call target: (identifier) @name)
        operator: "when")
    ])
  (#any-of? @form "def" "defp" "defdelegate" "defguard" "defguardp" "defmacro" "defmacrop" "defn" "defnp")) @definition.function
