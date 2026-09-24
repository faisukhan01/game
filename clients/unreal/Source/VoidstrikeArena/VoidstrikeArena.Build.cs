using UnrealBuildTool;

public class VoidstrikeArena : ModuleRules
{
	public VoidstrikeArena(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Networking",
			"Sockets",
			"Json",
			"JsonUtilities"
		});
	}
}
