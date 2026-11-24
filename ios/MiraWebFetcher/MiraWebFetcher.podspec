Pod::Spec.new do |s|
  s.name = 'MiraWebFetcher'
  s.version = '1.0.0'
  s.summary = 'Bounded public-only web transport for the Mira Mobile web tool.'
  s.homepage = 'https://github.com/uichat-mira/mira-mobile'
  s.license = { :type => 'MIT' }
  s.author = { 'Mira Mobile' => 'mobile@local.invalid' }
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.source_files = 'MiraWebFetcher.mm'
  s.frameworks = 'Foundation'
  s.dependency 'React-Core'
end
