module Asciidoctor

  class Converter::TemplateConverter < Converter::Base
    def initialize backend, template_dirs, opts = {}
      @backend = backend
      @engine = 'jade' # Only Jade/Pug templates are supported for now
      if template_dirs.kind_of?(String)
        @template_dirs = [template_dirs]
      else
        @template_dirs = template_dirs
      end
    end

    def handles? name
      !(resolve_template name).nil?
    end

    def resolve_template name
      path_resolver = PathResolver.new
      backend = @backend
      engine = @engine
      @template_dirs.each do |template_dir|
        # REMIND: All templates must be directly available in "template_dir"
        # TODO: Remove the following block of code once the Reveal.js backend template complies with this new convention
        # -- start
        if engine
          # example: templates/jade
          engine_dir = (::File.join template_dir, engine)
          template = ::File.join(engine_dir, name + "." + engine)
          if (content = try_read template)
            return content
          end
        end
        # -- end
        
        # example: templates
        template = ::File.join(template_dir, name + "." + engine)
        if (content = try_read template)
          return content
        end
      end
      return nil
    end

    def try_read name
      ::File.read(name)
    rescue IOError
      # Ignore error as Asciidoctor expect a nil value if the template is not found
      nil
    end

    def convert node, template_name = nil, opts = {}
      template_name ||= node.node_name
      unless (template = resolve_template template_name)
        raise %(Could not find a custom template to handle transform: #{template_name})
      end

      %x(
        if (typeof window !== 'undefined') {
          var jade = jade || window.jade;
        } else if (typeof require !== 'undefined') {
          var jade = jade || require('jade');
        } 
        var compiled = jade.compile(#{template}, {pretty: true});
        return compiled({ node: #{node} });
      )
    end
  end
end
