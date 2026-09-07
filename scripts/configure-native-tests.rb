#!/usr/bin/env ruby
require 'xcodeproj'
root = File.expand_path('..', __dir__)
project_path = File.join(root, 'ios-native/Focus.xcodeproj')
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'Focus' }
services = project.main_group.recursive_children.find { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.display_name == 'Services' }
path = 'FocusTelemetry.swift'
unless services.files.any? { |f| f.path == path }
  app.source_build_phase.add_file_reference(services.new_file(path))
end
[['FocusTests', :unit_test_bundle], ['FocusUITests', :ui_test_bundle]].each do |name, type|
  target = project.targets.find { |t| t.name == name } || project.new_target(type, name, :ios, '17.0')
  target.add_dependency(app) unless target.dependencies.any? { |d| d.target == app }
  group = project.main_group.groups.find { |g| g.path == name } || project.main_group.new_group(name, name)
  Dir.glob(File.join(root, 'ios-native', name, '*.swift')).each do |file|
    filename = File.basename(file)
    ref = group.files.find { |f| f.path == filename } || group.new_file(filename)
    target.source_build_phase.add_file_reference(ref, true)
  end
  target.build_configurations.each do |config|
    config.build_settings.merge!({
      'PRODUCT_NAME' => '$(TARGET_NAME)',
      'SWIFT_MODULE_NAME' => '$(PRODUCT_NAME:c99extidentifier)',
      'PRODUCT_BUNDLE_IDENTIFIER' => "me.usefocus.app.#{name.downcase}",
      'GENERATE_INFOPLIST_FILE' => 'YES',
      'SWIFT_VERSION' => '5.0',
      'TARGETED_DEVICE_FAMILY' => '1,2',
      'CODE_SIGN_STYLE' => 'Automatic',
      'DEVELOPMENT_TEAM' => 'D8UM897B2T',
      'TEST_TARGET_NAME' => 'Focus'
    })
    if type == :unit_test_bundle
      config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/Focus.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Focus'
      config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
    end
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.set_launch_target(app)
%w[FocusTests FocusUITests].each { |name| scheme.add_test_target(project.targets.find { |t| t.name == name }) }
scheme.save_as(project_path, 'Focus', true)
puts 'Focus scheme: app + unit tests + UI tests'
