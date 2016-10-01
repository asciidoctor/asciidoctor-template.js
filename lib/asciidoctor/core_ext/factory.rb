# encoding: UTF-8
module Asciidoctor
  # Monkey patch the create method to add JavaScript slide converters
  module Converter
    class Factory
      def create backend, opts = {}
        if (converter = resolve backend)
          if converter.is_a? ::Class
            return converter.new backend, opts
          else
            return converter
          end
        end
    
        base_converter = case backend
        when 'html5'
          unless defined? ::Asciidoctor::Converter::Html5Converter
            require 'asciidoctor/converter/html5'.to_s
          end
          Html5Converter.new backend, opts
        when 'docbook5'
          unless defined? ::Asciidoctor::Converter::DocBook5Converter
            require 'asciidoctor/converter/docbook5'.to_s
          end
          DocBook5Converter.new backend, opts
        when 'docbook45'
          unless defined? ::Asciidoctor::Converter::DocBook45Converter
            require 'asciidoctor/converter/docbook45'.to_s
          end
          DocBook45Converter.new backend, opts
        when 'manpage'
          unless defined? ::Asciidoctor::Converter::ManPageConverter
            require 'asciidoctor/converter/manpage'.to_s
          end
          ManPageConverter.new backend, opts
        end

        if backend == 'revealjs' && (JAVASCRIPT_PLATFORM == 'node' || JAVASCRIPT_PLATFORM == 'node-electron')
          if ::File.exist?(revealjs_templates_path = 'node_modules/asciidoctor-reveal.js/templates')
            opts[:template_dirs] = revealjs_templates_path unless opts.key? :template_dirs
          end
        end

        return base_converter unless opts.key? :template_dirs
    
        unless defined? ::Asciidoctor::Converter::TemplateConverter
          require 'asciidoctor/converter/template'.to_s
        end
        unless defined? ::Asciidoctor::Converter::CompositeConverter
          require 'asciidoctor/converter/composite'.to_s
        end
        template_converter = TemplateConverter.new backend, opts[:template_dirs], opts
        CompositeConverter.new backend, template_converter, base_converter
      end
    end
  end
end
