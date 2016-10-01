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
        # FIXME need to think about safe mode restrictions here
        next unless ::File.directory?(template_dir = (path_resolver.system_path template_dir, nil))

        # NOTE last matching template wins for template name if no engine is given
        if engine
          # example: templates/haml
          if ::File.directory?(engine_dir = (::File.join template_dir, engine))
            template_dir = engine_dir
          end
        end

        # example: templates/html5 or templates/haml/html5
        if ::File.directory?(backend_dir = (::File.join template_dir, backend))
          template_dir = backend_dir
        end

        template = ::File.join(template_dir, name + "." + engine)
        return ::File.read(template) if ::File.exist?(template);
      end
      return nil
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
