BEGIN {
	new_comment = 1;
	in_comment = 0;
}

/^\s*\/\// {
	if (new_comment) {
		new_comment = 0;
		print "/**";
	}
	in_comment = 1;
	$0.sub("^\t*//", " *");
	print $0;
}

/^\s*([a-z"]|$)/ {
	if (in_comment) {
		print " */";
		print "";
		in_comment = 0;
		new_comment = 1;
	}
}

END {
	if (in_comment) {
		print " */";
	}
}
