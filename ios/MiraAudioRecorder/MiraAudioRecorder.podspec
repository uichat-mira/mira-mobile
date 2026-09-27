Pod::Spec.new do |s|
  s.name = 'MiraAudioRecorder'
  s.version = '1.0.0'
  s.summary = 'Private local audio recording bridge for Mira Shiyan.'
  s.homepage = 'https://github.com/uichat-mira/mira-mobile'
  s.license = { :type => 'MIT' }
  s.author = { 'Mira Mobile' => 'mobile@local.invalid' }
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.source_files = 'MiraAudioRecorder.mm'
  s.frameworks = 'AVFoundation'
  s.dependency 'React-Core'
end
